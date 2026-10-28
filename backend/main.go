// 笔顺 的后端。网关已经校验过登录，这里用 SDK 拿到当前用户；数据存在本模块卷里的 SQLite 文件。
package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"
	"unicode"

	"github.com/Beane-Big/vibebooth/packages/sdk-go/auth"
)

const moduleID = "bishun"

// routes 收集其他文件注册的对内接口：npx github:Beane-Big/create-vibebooth add 加的示例文件用它把接口挂上来。
var routes []func(api *http.ServeMux)

func main() {
	store, err := OpenStore(filepath.Join(env("DATA_DIR", "/data"), "bishun.db"))
	if err != nil {
		slog.Error("打开数据库失败", "err", err)
		os.Exit(1)
	}
	verifier := auth.NewVerifier(env("JWKS_URL", "http://core:8080/api/platform/.well-known/jwks.json"), moduleID)

	// 对内接口：只给本模块前端用，需要登录。
	api := http.NewServeMux()
	api.HandleFunc("GET /api/bishun/me", func(w http.ResponseWriter, r *http.Request) {
		user := auth.UserFrom(r.Context())
		writeJSON(w, http.StatusOK, map[string]any{"name": user.Name, "menus": user.Menus, "perms": user.Perms, "all": user.All})
	})
	// 重难点字：只读写当前用户自己的数据。模块没有功能权限，能打开“笔顺”菜单的人就能用。
	api.HandleFunc("GET /api/bishun/hard-words", func(w http.ResponseWriter, r *http.Request) {
		user := auth.UserFrom(r.Context())
		if !user.HasMenu("home") {
			writeError(w, http.StatusForbidden, "没有权限")
			return
		}
		list, err := store.HardWords(r.Context(), user.ID)
		if err != nil {
			slog.Error("读取重难点失败", "err", err)
			writeError(w, http.StatusInternalServerError, "读取失败")
			return
		}
		writeJSON(w, http.StatusOK, list)
	})
	api.HandleFunc("POST /api/bishun/hard-words", func(w http.ResponseWriter, r *http.Request) {
		user := auth.UserFrom(r.Context())
		if !user.HasMenu("home") {
			writeError(w, http.StatusForbidden, "没有权限")
			return
		}
		var in struct {
			Char string `json:"char"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil || !validChar(in.Char) {
			writeError(w, http.StatusBadRequest, "只能记录一个汉字、字母或数字")
			return
		}
		word, err := store.AddMiss(r.Context(), user.ID, in.Char)
		if err != nil {
			slog.Error("保存重难点失败", "err", err)
			writeError(w, http.StatusInternalServerError, "保存失败")
			return
		}
		writeJSON(w, http.StatusOK, word)
	})
	api.HandleFunc("DELETE /api/bishun/hard-words/{char}", func(w http.ResponseWriter, r *http.Request) {
		user := auth.UserFrom(r.Context())
		if !user.HasMenu("home") {
			writeError(w, http.StatusForbidden, "没有权限")
			return
		}
		if err := store.RemoveHardWord(r.Context(), user.ID, r.PathValue("char")); err != nil {
			slog.Error("移出重难点失败", "err", err)
			writeError(w, http.StatusInternalServerError, "移出失败")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	for _, add := range routes {
		add(api)
	}

	// 独立模式（npm run standalone）：离开平台单独运行时不校验令牌，当成一个拥有全部权限的本地用户。平台不会设这个变量。
	guard := verifier.Middleware
	if os.Getenv("STANDALONE") == "1" {
		slog.Warn("独立模式：不校验令牌，所有请求都是拥有全部权限的本地用户")
		guard = auth.Standalone("本地用户")
	}

	mux := http.NewServeMux()
	// 健康检查由平台在内部网络直接调用，不经过网关，也不需要令牌。
	mux.HandleFunc("GET /api/bishun/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.Handle("/api/bishun/", guard(api))

	srv := &http.Server{Addr: ":8000", Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	slog.Info("bishun 模块已启动", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("服务退出", "err", err)
		os.Exit(1)
	}
}

// validChar 只接受一个汉字、英文字母或数字，和前端能练的内容一致。
func validChar(s string) bool {
	r := []rune(s)
	return len(r) == 1 && (unicode.Is(unicode.Han, r[0]) || r[0] < unicode.MaxASCII && (unicode.IsLetter(r[0]) || unicode.IsDigit(r[0])))
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
