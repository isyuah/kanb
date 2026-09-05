# syntax: docker/dockerfile:1
# 多阶段自包含构建：前端产物 → Go 交叉编译 → 精简运行镜像。
# 用法：docker compose -f deploy/docker-compose.yml up --build

# ---- 阶段 1: 前端构建（Node）----
FROM node:20-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# outDir 为 ../server/webdist（相对 web/），产物落在 /src/server/webdist
RUN npm run build

# ---- 阶段 2: 后端交叉编译（embed webdist）----
FROM golang:1.27-alpine AS gobuild
WORKDIR /src
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download
COPY server/ ./server/
# 前端产物拷入（embed all:webdist 需要目录非空）
COPY --from=web /src/server/webdist ./server/webdist
WORKDIR /src/server
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN go build -trimpath -o /out/kanb-server .

# ---- 阶段 3: 运行镜像 ----
FROM alpine:3.20
RUN addgroup -g 10001 kanb && adduser -u 10001 -G kanb -D -h /app kanb
WORKDIR /app
COPY --from=gobuild /out/kanb-server /app/kanb-server
USER kanb
EXPOSE 8400
VOLUME /data
ENTRYPOINT ["/app/kanb-server"]
CMD ["-addr", ":8400", "-db", "/data/kanb.db"]
