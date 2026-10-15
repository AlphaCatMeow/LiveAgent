package server

import (
	"github.com/liveagent/agent-gateway/internal/config"
	"github.com/liveagent/agent-gateway/internal/kbrain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSingleUserImageDeploymentExplicitAndLoopback(t *testing.T) {
	cfg := &config.Config{Token: "gateway-fixture", KBrainToken: "backend-fixture", KBrainURL: "http://127.0.0.1:1", KBrainAgentID: "selected"}
	if singleUserImages(cfg) != nil {
		t.Fatal("enabled without opt-in")
	}
	cfg.ImageSingleUser = true
	if singleUserImages(cfg) == nil {
		t.Fatal("explicit local mode unavailable")
	}
	for _, raw := range []string{"https://example.com", "http://localhost:1", "http://user:secret@127.0.0.1:1", "http://127.0.0.1:1?token=secret"} {
		cfg.KBrainURL = raw
		if singleUserImages(cfg) != nil {
			t.Fatal("unsafe backend accepted")
		}
	}
}
func TestSingleUserImageIdentityAndLocalForwarding(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer backend-fixture" || r.Header.Get(kbrain.ImageDelegationHeader) != "" || r.Header.Get("X-Owner-ID") != "" {
			t.Fatal("unsafe upstream identity")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"kbrain.image.v1","items":[]}`))
	}))
	defer upstream.Close()
	cfg := &config.Config{ImageSingleUser: true, Token: "gateway-fixture", KBrainToken: "backend-fixture", KBrainURL: upstream.URL, KBrainAgentID: "selected"}
	images := singleUserImages(cfg)
	if images == nil {
		t.Fatal("not configured")
	}
	r := httptest.NewRequest("GET", "/api/image/identity", nil)
	w := httptest.NewRecorder()
	singleUserImageIdentity(cfg, images)(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	r.Header.Set("Authorization", "Bearer gateway-fixture")
	w = httptest.NewRecorder()
	singleUserImageIdentity(cfg, images)(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"ownerId":"local"`) || strings.Contains(w.Body.String(), "fixture") {
		t.Fatal("identity invalid or secret exposed")
	}
	r = httptest.NewRequest("GET", "/api/image/targets?backendId=selected", nil)
	r.Header.Set("Authorization", "Bearer gateway-fixture")
	r.Header.Set("X-Owner-ID", "forged")
	w = httptest.NewRecorder()
	images.ServeHTTP(w, r)
	if w.Code != 200 || calls != 1 {
		t.Fatalf("forward %d calls%d", w.Code, calls)
	}
}
