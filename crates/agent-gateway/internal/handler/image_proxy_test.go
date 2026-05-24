package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestImageProxyServesSupportedImage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != imageProxyAccept {
			t.Fatalf("upstream Accept = %q, want %q", got, imageProxyAccept)
		}
		if got := r.Header.Get("Accept-Language"); got != imageProxyAcceptLanguage {
			t.Fatalf("upstream Accept-Language = %q, want %q", got, imageProxyAcceptLanguage)
		}
		if got := r.Header.Get("User-Agent"); got != imageProxyUserAgent {
			t.Fatalf("upstream User-Agent = %q, want %q", got, imageProxyUserAgent)
		}
		if got, want := r.Header.Get("Referer"), upstreamOrigin(r)+"/"; got != want {
			t.Fatalf("upstream Referer = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nliveagent-test"))
	}))
	defer upstream.Close()

	req := httptest.NewRequest(http.MethodGet, "/image-proxy?url="+upstream.URL+"/photo.png", nil)
	rec := httptest.NewRecorder()
	ImageProxy(time.Second)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d body=%q", http.StatusOK, rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content-type = %q, want image/png", got)
	}
}

func TestImageProxyRefererUsesTargetOrigin(t *testing.T) {
	targetURL, err := url.Parse("https://example.com:8443/path/photo.png?size=large")
	if err != nil {
		t.Fatalf("parse target url: %v", err)
	}

	if got, want := imageProxyReferer(targetURL), "https://example.com:8443/"; got != want {
		t.Fatalf("referer = %q, want %q", got, want)
	}
}

func TestApplyImageProxyRequestHeaders(t *testing.T) {
	targetURL, err := url.Parse("https://example.com/path/photo.png")
	if err != nil {
		t.Fatalf("parse target url: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/proxy", nil)

	applyImageProxyRequestHeaders(req, targetURL)

	if got := req.Header.Get("Accept"); got != imageProxyAccept {
		t.Fatalf("Accept = %q, want %q", got, imageProxyAccept)
	}
	if got := req.Header.Get("Accept-Language"); got != imageProxyAcceptLanguage {
		t.Fatalf("Accept-Language = %q, want %q", got, imageProxyAcceptLanguage)
	}
	if got := req.Header.Get("User-Agent"); got != imageProxyUserAgent {
		t.Fatalf("User-Agent = %q, want %q", got, imageProxyUserAgent)
	}
	if got, want := req.Header.Get("Referer"), "https://example.com/"; got != want {
		t.Fatalf("Referer = %q, want %q", got, want)
	}
}

func TestImageProxyRejectsNonImage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html></html>"))
	}))
	defer upstream.Close()

	req := httptest.NewRequest(http.MethodGet, "/image-proxy?url="+upstream.URL+"/page", nil)
	rec := httptest.NewRecorder()
	ImageProxy(time.Second)(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected status %d, got %d", http.StatusBadGateway, rec.Code)
	}
}

func upstreamOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
