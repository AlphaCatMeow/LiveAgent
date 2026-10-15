package server

import (
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/liveagent/agent-gateway/internal/auth"
	"github.com/liveagent/agent-gateway/internal/config"
	"github.com/liveagent/agent-gateway/internal/handler"
	"github.com/liveagent/agent-gateway/internal/kbrain"
)

// This mode is explicitly private/single-owner. It never creates multiple user
// identities from a shared management token. K-Brain must run on this host and
// explicitly permit authenticated local image scope.
func singleUserImages(cfg *config.Config) *handler.ImageGateway {
	if cfg == nil || !cfg.ImageSingleUser {
		return nil
	}
	u, err := url.Parse(cfg.KBrainURL)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || cfg.Token == "" || cfg.KBrainToken == "" || strings.TrimSpace(cfg.KBrainAgentID) == "" {
		return nil
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() || (u.Scheme != "http" && u.Scheme != "https") {
		return nil
	}
	client, err := kbrain.New(cfg.KBrainURL, cfg.KBrainToken, &http.Client{Transport: &http.Transport{Proxy: nil}})
	if err != nil {
		return nil
	}
	id := cfg.KBrainAgentID
	return &handler.ImageGateway{Backends: map[string]handler.ImageBackend{id: {Client: client, SingleUserLocal: true}}, ResolvePrincipal: func(r *http.Request) (auth.ImagePrincipal, error) {
		if !auth.ValidateBearerHeader(r.Header.Get("Authorization"), cfg.Token) {
			return auth.ImagePrincipal{}, http.ErrNoCookie
		}
		return auth.ImagePrincipal{OwnerID: "local", Backends: map[string]auth.ImageGrant{id: {Execute: true, Configure: true}}}, nil
	}}
}

func singleUserImageIdentity(cfg *config.Config, images *handler.ImageGateway) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if cfg == nil || !cfg.ImageSingleUser || images == nil {
			writeJSON(w, 503, map[string]any{"error": map[string]any{"code": "IMAGE_IDENTITY_UNAVAILABLE"}})
			return
		}
		if !auth.ValidateBearerHeader(r.Header.Get("Authorization"), cfg.Token) {
			writeJSON(w, 401, map[string]any{"error": map[string]any{"code": "IMAGE_AUTH_REQUIRED"}})
			return
		}
		writeJSON(w, 200, map[string]any{"ownerId": "local", "backendId": cfg.KBrainAgentID, "mode": "single_user"})
	}
}
