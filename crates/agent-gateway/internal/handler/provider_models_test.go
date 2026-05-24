package handler

import "testing"

func TestBuildProviderModelsURLForGemini(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"https://generativelanguage.googleapis.com":                                                    "https://generativelanguage.googleapis.com/v1beta/models",
		"https://generativelanguage.googleapis.com/v1beta":                                             "https://generativelanguage.googleapis.com/v1beta/models",
		"https://generativelanguage.googleapis.com/v1beta/models":                                      "https://generativelanguage.googleapis.com/v1beta/models",
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent":       "https://generativelanguage.googleapis.com/v1beta/models",
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent": "https://generativelanguage.googleapis.com/v1beta/models",
	}

	for input, want := range cases {
		got, err := buildProviderModelsURL("gemini", input)
		if err != nil {
			t.Fatalf("buildProviderModelsURL(%q) error = %v", input, err)
		}
		if got != want {
			t.Fatalf("buildProviderModelsURL(%q) = %q, want %q", input, got, want)
		}
	}
}
