package main

// 应用日志：zerolog 控制台输出，级别与格式经启动参数配置（见 main.go）。
import (
	"os"
	"time"

	"github.com/rs/zerolog"
)

var log = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
	With().Timestamp().
	Logger()

// setupLog 按 -log-level 设置最低输出级别；-log-json 时切换纯 JSON 输出。
func setupLog(level string, jsonOut bool) {
	if jsonOut {
		log = zerolog.New(os.Stderr).With().Timestamp().Logger()
	}
	lv, err := zerolog.ParseLevel(level)
	if err != nil {
		lv = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lv)
}
