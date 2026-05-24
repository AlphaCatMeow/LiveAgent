package handler

import (
	"reflect"
	"testing"
)

func TestNormalizeExecutionMode(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"":          "text",
		" text ":    "text",
		"tools":     "tools",
		"agent-dev": "agent-dev",
		"unknown":   "text",
	}

	for input, want := range cases {
		if got := NormalizeExecutionMode(input); got != want {
			t.Fatalf("NormalizeExecutionMode(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestNormalizeSelectedSystemTools(t *testing.T) {
	t.Parallel()

	got := NormalizeSelectedSystemTools([]string{
		" http_get_test ",
		"http_get_test",
		"",
		"unknown_tool",
	})
	want := []string{"http_get_test"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("NormalizeSelectedSystemTools() = %#v, want %#v", got, want)
	}
}

func TestNormalizeChatSelectedModelAcceptsGemini(t *testing.T) {
	t.Parallel()

	got, err := NormalizeChatSelectedModel(&ChatSelectedModelBody{
		CustomProviderID: " gemini-provider ",
		Model:            " gemini-3.5-flash ",
		ProviderType:     " gemini ",
	})
	if err != nil {
		t.Fatalf("NormalizeChatSelectedModel() error = %v", err)
	}
	if got.CustomProviderID != "gemini-provider" ||
		got.Model != "gemini-3.5-flash" ||
		got.ProviderType != "gemini" {
		t.Fatalf("NormalizeChatSelectedModel() = %#v", got)
	}
}

func TestNormalizeChatUploadedFiles(t *testing.T) {
	t.Parallel()

	got := NormalizeChatUploadedFiles([]ChatUploadedFileBody{
		{
			RelativePath: " docs/spec.md ",
			AbsolutePath: " /tmp/docs/spec.md ",
			FileName:     " spec.md ",
			Kind:         "text",
			SizeBytes:    128,
		},
		{
			RelativePath: "docs/spec.md",
			FileName:     "spec.md",
			Kind:         "text",
			SizeBytes:    128,
		},
		{
			RelativePath: "bad.bin",
			FileName:     "bad.bin",
			Kind:         "binary",
			SizeBytes:    64,
		},
		{
			RelativePath: "uploads/report.docx",
			FileName:     "report.docx",
			Kind:         "word",
			SizeBytes:    256,
		},
		{
			RelativePath: "uploads/workbook.xlsx",
			FileName:     "workbook.xlsx",
			Kind:         "spreadsheet",
			SizeBytes:    512,
		},
		{
			RelativePath: "uploads/assets.zip",
			FileName:     "assets.zip",
			Kind:         "archive",
			SizeBytes:    1024,
		},
	})
	want := []ChatUploadedFileBody{
		{
			RelativePath: "docs/spec.md",
			AbsolutePath: "/tmp/docs/spec.md",
			FileName:     "spec.md",
			Kind:         "text",
			SizeBytes:    128,
		},
		{
			RelativePath: "uploads/report.docx",
			FileName:     "report.docx",
			Kind:         "word",
			SizeBytes:    256,
		},
		{
			RelativePath: "uploads/workbook.xlsx",
			FileName:     "workbook.xlsx",
			Kind:         "spreadsheet",
			SizeBytes:    512,
		},
		{
			RelativePath: "uploads/assets.zip",
			FileName:     "assets.zip",
			Kind:         "archive",
			SizeBytes:    1024,
		},
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("NormalizeChatUploadedFiles() = %#v, want %#v", got, want)
	}
}
