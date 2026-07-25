# Repository Guidelines

## Project Structure & Module Organization

LiveAgent is a local-first Tauri desktop client with an optional Go gateway. `crates/agent-gui/src/` contains the React/TypeScript desktop UI, while `crates/agent-gui/src-tauri/src/` contains its Rust services and commands. Its JavaScript tests live in `crates/agent-gui/test/`.

`crates/agent-gateway/` is the Go service: `cmd/gateway/` is the entry point, `internal/` contains implementation packages, and `proto/v2/` defines the wire protocol. Its embedded browser UI is in `crates/agent-gateway/web/`; Go and WebUI tests are under `crates/agent-gateway/test/`. Keep architecture and operational documentation in `docs/`; release and maintenance utilities belong in `scripts/`.

## Build, Test, and Development Commands

Install pinned tooling with `mise install`, then install dependencies in each changed pnpm package with `pnpm install --frozen-lockfile`.

- `make dev` starts the Tauri desktop app; `make build` creates a desktop build.
- `make dev-gateway` and `make dev-webui` run the gateway and its Vite UI locally.
- `pnpm -C crates/agent-gui test:frontend` runs desktop frontend tests; `cargo test --manifest-path crates/agent-gui/src-tauri/Cargo.toml` runs Rust tests.
- `go -C crates/agent-gateway test ./...` runs gateway tests. In `crates/agent-gateway/web/`, run `pnpm build && pnpm lint && pnpm test`.
- After changing `proto/v2/*.proto`, run `make proto` and commit generated Go and TypeScript outputs; use `make proto-check` before proposing protocol changes.

## Coding Style & Naming Conventions

Use Biome for TypeScript, TSX, and CSS: two-space indentation, double quotes, semicolons, trailing commas, and a 100-column line limit. Run `pnpm lint` before submitting. Match existing Go and Rust style; format changed files with `gofmt` and `cargo fmt`. Name React components in `PascalCase`, hooks as `useThing`, and tests as descriptive `*.test.mjs` or `*_test.go` files. Do not hand-edit generated protocol or model-catalog files.

## Testing Guidelines

Add a focused regression test beside the affected area. Run all applicable package checks, plus `node scripts/check-mirror.mjs` when modifying mirrored GUI/WebUI code, and `git diff --check` before review. Run `pnpm -C crates/agent-gui test:release` for release-script changes.

## Commit & Pull Request Guidelines

Use concise Conventional Commit subjects, usually with a scope: `feat(settings): add provider option`, `fix(gateway): reject invalid frame`, or `docs: clarify deployment`. Keep commits narrowly focused. PRs should explain the user-facing effect, link relevant issues, list checks run, and include screenshots for visual GUI or WebUI changes.
