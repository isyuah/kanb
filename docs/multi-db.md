# 多数据库支持（SQLite / PostgreSQL）

Kanb 的 Store 层基于 `database/sql` + 手写 SQL，通过少量方言适配同时支持 **SQLite**（默认，零配置）与 **PostgreSQL**（云端托管）。设计原则：**抽象方言差异，不抽象 SQL**——统一 SQL 全部写 `?` 占位符，执行时按方言翻译。

## 选择后端

| 场景 | 方式 |
|---|---|
| 本地 / Docker 默认 | 直接 `-db kanb.db`，无需任何配置 |
| 云端（Render / Supabase / Neon 等） | 设置环境变量 `KANB_DATABASE_URL` 指向 PostgreSQL，启动命令不变 |

```bash
# SQLite（默认）
./kanb-server -addr :8400 -db kanb.db

# PostgreSQL（设置环境变量后同一二进制）
KANB_DATABASE_URL="postgres://user:pass@host:5432/kanb?sslmode=require" ./kanb-server -addr :8400
```

连接池大小可用 `KANB_PG_MAX_OPEN` / `KANB_PG_MAX_IDLE` 覆盖（默认 5/2——PG 连接数属部署配置而非方言规定，按数据库配额调整）。

## 方言差异处理（全部集中在 store.go）

| 差异 | 处理 |
|---|---|
| `?` → `$1,$2…` | `Store.bind()` 用 `sqlx.Rebind` 翻译（SQLite 原样） |
| 唯一/主键冲突识别 | `Store.isUniqueViolation()` 按方言错误类型（SQLite 扩展码 1555/2067；PG `23505`） |
| 外键启用 | SQLite 经 DSN `_pragma=foreign_keys(1)`（连接级设置放 DSN 才可靠）；PG 默认开启 |
| 连接数 | SQLite 强制 1（文件锁串行化写）；PG 可配置 |
| `INSERT OR IGNORE` | 统一改写为 `ON CONFLICT (…) DO NOTHING`（两库原生支持）——**注意不要**用「普通 INSERT + 吞唯一错误」模拟：PG 事务内语句报错后整个事务进入 aborted 态，后续语句全失败 |
| 表创建顺序 | 被引用表必须先建（task_tags 在 tasks 之后）——SQLite 宽松、PG 严格 |
| GROUP BY | SELECT 的非聚合列必须进 GROUP BY（PG 严格模式） |
| 排序稳定性 | 同秒时间戳记录加主键作次级排序键（PG 无 SQLite 的 rowid 隐式序） |

## 开发与测试

同一套 contract 测试在双库上跑：测试通过 `newTestStore` 打开后端，设 `KANB_TEST_DATABASE_URL` 即切 PG（每测试独立 schema，自动清理）。

```bash
# SQLite
cd server && go test ./...

# PostgreSQL（本地起容器示例）
docker run -d --name kanb-pg -e POSTGRES_PASSWORD=testpass -e POSTGRES_USER=testuser \
  -e POSTGRES_DB=kanbtest -p 55432:5432 postgres:16-alpine
KANB_TEST_DATABASE_URL="postgres://testuser:testpass@127.0.0.1:55432/kanbtest?sslmode=disable" \
  go test -count=1 ./...
```

CI（`.github/workflows/ci.yml`）的 backend job 内嵌 postgres service，push 即双库验证。

## 数据迁移说明

SQLite 库与 PG 库之间**没有自动迁移**——两库 schema 一致但数据不互通，切换后端需重建数据（演示数据用 `scripts/seed-demo.mjs`）。表结构本身两库共用同一份 DDL，无方言分叉。
