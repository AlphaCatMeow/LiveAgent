package handler

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	imageProxyMaxBytes       = 25 * 1024 * 1024
	imageProxyAccept         = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
	imageProxyAcceptLanguage = "en-US,en;q=0.9"
	imageProxyUserAgent      = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

func ImageProxy(timeout time.Duration) http.HandlerFunc {
	client := &http.Client{Timeout: timeout}
	return func(w http.ResponseWriter, r *http.Request) {
		rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
		targetURL, err := validateImageProxyURL(rawURL)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		upstreamReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL.String(), nil)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to create image proxy request: %v", err), http.StatusBadRequest)
			return
		}
		applyImageProxyRequestHeaders(upstreamReq, targetURL)

		resp, err := client.Do(upstreamReq)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to load image through proxy: %v", err), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			http.Error(w, fmt.Sprintf("image proxy upstream returned HTTP status %d", resp.StatusCode), http.StatusBadGateway)
			return
		}
		if resp.ContentLength > imageProxyMaxBytes {
			http.Error(w, "image proxy response is too large", http.StatusRequestEntityTooLarge)
			return
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, imageProxyMaxBytes+1))
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to read image proxy response: %v", err), http.StatusBadGateway)
			return
		}
		if len(body) > imageProxyMaxBytes {
			http.Error(w, "image proxy response is too large", http.StatusRequestEntityTooLarge)
			return
		}

		mimeType, ok := resolveImageProxyMime(resp.Header.Get("Content-Type"), body)
		if !ok {
			http.Error(w, "image proxy upstream response is not a supported image", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", mimeType)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
		w.Header().Set("Cache-Control", "private, max-age=300")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		_, _ = w.Write(body)
	}
}

func applyImageProxyRequestHeaders(req *http.Request, targetURL *url.URL) {
	req.Header.Set("Accept", imageProxyAccept)
	req.Header.Set("Accept-Language", imageProxyAcceptLanguage)
	req.Header.Set("User-Agent", imageProxyUserAgent)
	req.Header.Set("Referer", imageProxyReferer(targetURL))
}

func imageProxyReferer(targetURL *url.URL) string {
	if targetURL == nil || targetURL.Scheme == "" || targetURL.Host == "" {
		return ""
	}
	return (&url.URL{Scheme: targetURL.Scheme, Host: targetURL.Host, Path: "/"}).String()
}

func validateImageProxyURL(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, fmt.Errorf("url is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("image URL must be absolute: %v", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("image proxy only supports http and https, got %s", parsed.Scheme)
	}
	if parsed.Host == "" || parsed.User != nil {
		return nil, fmt.Errorf("image URL must be a valid absolute URL without embedded credentials")
	}
	return parsed, nil
}

func normalizeImageProxyMime(value string) (string, bool) {
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	switch mimeType {
	case "image/png":
		return "image/png", true
	case "image/jpeg", "image/jpg":
		return "image/jpeg", true
	case "image/gif":
		return "image/gif", true
	case "image/webp":
		return "image/webp", true
	case "image/bmp":
		return "image/bmp", true
	case "image/svg+xml":
		return "image/svg+xml", true
	case "image/x-icon", "image/vnd.microsoft.icon":
		return "image/x-icon", true
	default:
		return "", false
	}
}

func looksLikeSVG(body []byte) bool {
	prefixLen := len(body)
	if prefixLen > 1024 {
		prefixLen = 1024
	}
	prefix := strings.TrimSpace(strings.TrimPrefix(string(body[:prefixLen]), "\ufeff"))
	return strings.HasPrefix(prefix, "<svg") || strings.Contains(prefix, "<svg")
}

func inferImageProxyMimeFromBytes(body []byte) (string, bool) {
	if len(body) >= 8 && string(body[:8]) == "\x89PNG\r\n\x1a\n" {
		return "image/png", true
	}
	if len(body) >= 3 && body[0] == 0xff && body[1] == 0xd8 && body[2] == 0xff {
		return "image/jpeg", true
	}
	if len(body) >= 6 && (string(body[:6]) == "GIF87a" || string(body[:6]) == "GIF89a") {
		return "image/gif", true
	}
	if len(body) >= 12 && string(body[:4]) == "RIFF" && string(body[8:12]) == "WEBP" {
		return "image/webp", true
	}
	if len(body) >= 2 && string(body[:2]) == "BM" {
		return "image/bmp", true
	}
	if len(body) >= 4 && body[0] == 0x00 && body[1] == 0x00 && body[2] == 0x01 && body[3] == 0x00 {
		return "image/x-icon", true
	}
	if looksLikeSVG(body) {
		return "image/svg+xml", true
	}
	return "", false
}

func resolveImageProxyMime(contentType string, body []byte) (string, bool) {
	if mimeType, ok := normalizeImageProxyMime(contentType); ok {
		return mimeType, true
	}
	return inferImageProxyMimeFromBytes(body)
}
