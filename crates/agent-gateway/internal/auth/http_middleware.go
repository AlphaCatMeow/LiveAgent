package auth

import (
	"encoding/json"
	"net/http"
	"strings"
)

func HTTPMiddleware(expectedToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ValidateBearerHeader(r.Header.Get("Authorization"), expectedToken) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func ValidateBearerHeader(headerValue, expectedToken string) bool {
	headerValue = strings.TrimSpace(headerValue)
	expectedToken = strings.TrimSpace(expectedToken)
	if headerValue == "" {
		return false
	}
	parts := strings.SplitN(headerValue, " ", 2)
	if len(parts) != 2 {
		return false
	}
	if !strings.EqualFold(parts[0], "Bearer") {
		return false
	}
	return expectedToken != "" && strings.TrimSpace(parts[1]) == expectedToken
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": message,
	})
}
