package main

import (
	"io"
	"testing"
	"time"
)

func TestDesktopParentPipeKeepsServiceAliveUntilOwnerCloses(t *testing.T) {
	reader, writer := io.Pipe()
	t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
	closed := desktopParentClosed(reader)
	if _, err := writer.Write([]byte("ignored")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
		t.Fatal("an open parent pipe must keep the Gateway running")
	default:
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Gateway did not detect the closed desktop parent pipe")
	}
}

func TestDesktopParentPipeFailureAlsoReleasesService(t *testing.T) {
	reader, writer := io.Pipe()
	t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
	closed := desktopParentClosed(reader)
	_ = writer.CloseWithError(io.ErrClosedPipe)
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Gateway did not handle a failed desktop parent pipe")
	}
}
