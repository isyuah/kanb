package main

import (
	_ "embed"
	"net/http"
)

// guide.md 内嵌 AI 使用指南（公开只读，供 MCP 的 get_usage_guide 工具与
// kanb://guide 资源按需拉取）。内容与 docs/mcp.md 约定同步，改动需两处同步。
//
//go:embed guide.md
var guideDoc []byte

// handleGuide 返回指南原文。公开端点：内容为使用说明，无敏感信息；
// private 模式下 MCP 匿名调用也能拿到（工具描述自带兜底要点）。
func (a *app) handleGuide(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(guideDoc)
}
