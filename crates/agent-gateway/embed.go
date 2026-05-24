package gateway

import "embed"

// WebUIAssets contains the embedded WebUI build output served by the HTTP server.
//
//go:embed web/dist
var WebUIAssets embed.FS
