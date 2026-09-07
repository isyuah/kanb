package main

import (
	"embed"
	"flag"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

//go:embed all:webdist
var webFS embed.FS

// openDB 按环境选择后端：
//   - KANB_DATABASE_URL 非空 → PostgreSQL（Render/Supabase/Neon 等）
//   - 否则 → SQLite 文件（-db 指定路径，默认 kanb.db）
func openDB(sqlitePath string) (*Store, error) {
	if url := os.Getenv("KANB_DATABASE_URL"); url != "" {
		return OpenPostgres(url)
	}
	return OpenSQLite(sqlitePath)
}

func main() {
	addr := flag.String("addr", ":8400", "listen address")
	dbPath := flag.String("db", "kanb.db", "sqlite database file path")
	logLevel := flag.String("log-level", "info", "log level: debug|info|warn|error")
	logJSON := flag.Bool("log-json", false, "output logs as JSON lines")
	flag.Parse()
	setupLog(*logLevel, *logJSON)

	store, err := openDB(*dbPath)
	if err != nil {
		log.Fatal().Err(err).Msg("open store")
	}
	defer store.Close()
	store.Seed() // roles 字典 + anonymous 账号 + 默认公开度（幂等）

	a := &app{store: store, hub: newHub()}

	// API routes
	mux := http.NewServeMux()
	mux.Handle("/api/", a.routes())

	// Static files (embedded webdist) for production
	distFS, err := fs.Sub(webFS, "webdist")
	if err != nil {
		log.Warn().Msg("webdist not embedded; serving API only")
	} else {
		fileServer := http.FileServer(http.FS(distFS))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			// 带内容 hash 的构建产物（/assets/*）可永久缓存：文件名变=内容变，
			// 不存在过期失效问题。HTML/favicon 等不缓存，保证 SPA 入口始终新鲜。
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			// SPA fallback: serve index.html for non-file paths
			p := path.Clean(r.URL.Path)
			if p == "/" {
				r.URL.Path = "/"
				fileServer.ServeHTTP(w, r)
				return
			}
			// try file first
			if _, err := fs.Stat(distFS, strings.TrimPrefix(p, "/")); err == nil {
				fileServer.ServeHTTP(w, r)
				return
			}
			// SPA fallback
			r.URL.Path = "/"
			fileServer.ServeHTTP(w, r)
		})
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Info().Str("addr", *addr).Str("db", *dbPath).Msg("kanb server listening")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("http server")
	}
}

var _ = os.Getenv
