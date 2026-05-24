package config

import (
	"flag"
	"io"
	"os"
	"testing"
)

func TestLoadNormalizesTokenAndTLSPaths(t *testing.T) {
	oldCommandLine := flag.CommandLine
	oldArgs := os.Args
	defer func() {
		flag.CommandLine = oldCommandLine
		os.Args = oldArgs
	}()

	flag.CommandLine = flag.NewFlagSet("gateway", flag.ContinueOnError)
	flag.CommandLine.SetOutput(io.Discard)
	os.Args = []string{"gateway"}

	t.Setenv("LIVEAGENT_GATEWAY_TOKEN", "  secret-token\r\n")
	t.Setenv("LIVEAGENT_GATEWAY_TLS_CERT", " cert.pem ")
	t.Setenv("LIVEAGENT_GATEWAY_TLS_KEY", "\tkey.pem\r\n")

	cfg := Load()
	if cfg.Token != "secret-token" {
		t.Fatalf("Token = %q, want %q", cfg.Token, "secret-token")
	}
	if cfg.TLSCert != "cert.pem" {
		t.Fatalf("TLSCert = %q, want %q", cfg.TLSCert, "cert.pem")
	}
	if cfg.TLSKey != "key.pem" {
		t.Fatalf("TLSKey = %q, want %q", cfg.TLSKey, "key.pem")
	}
}
