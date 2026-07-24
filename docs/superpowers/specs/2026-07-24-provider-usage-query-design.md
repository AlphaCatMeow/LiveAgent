# Provider Usage Query Design

## Goal

Add API-only balance and quota queries to LiveAgent provider configuration for `claude_code`, `codex`, `gemini`, and `xai`. The feature must work in desktop builds for macOS, Windows, and Linux and in the Gateway WebUI.

## Scope

Each custom provider gains an optional `usageQuery` configuration. Queries are disabled by default and may use a built-in provider adapter, a Coding Plan API adapter, a General/NewAPI template, or a user-provided JavaScript template. CLI login files, OAuth, and subscription-account quotas are explicitly out of scope.

The desktop backend owns API keys, execution, cache, and outbound network access. The Gateway and WebUI only receive redacted configuration plus display-ready query results. A Gateway request is relayed to the connected desktop client, which executes the query and returns the result.

## Data Model

`UsageQueryConfig` stores `enabled`, `mode`, optional template/script, `autoRefreshSeconds`, and `allowLocalNetwork`. `UsageQueryResult` stores named display values, a successful timestamp, a transient error string, and an `isStale` flag. Results are keyed by provider ID and retained in memory for the desktop session; a failed refresh keeps the last successful values visible.

The initial result model is intentionally display-oriented: each entry has a label and value, with an optional unit. This supports currency balances and rate-limit windows without forcing all APIs into one numeric schema.

## Execution and Security

The Rust usage service builds built-in HTTP requests from the provider configuration and evaluates templates with the provider API key and Base URL. General/NewAPI templates require HTTPS and same-origin URLs. Custom JavaScript runs in QuickJS with only an injected `fetch` capability and template variables; no filesystem, process, shell, or system APIs are exposed.

All destinations reject URL credentials and addresses that resolve to loopback, link-local, private, or cloud-metadata ranges unless `allowLocalNetwork` is enabled. Enabling a custom query requires an explicit security confirmation. Query failures are user-visible but never include secrets.

## User Experience

Provider cards show the latest successful result, its update time, stale state, and a refresh control. The provider dialog exposes enablement, query mode, template/script editing, local-network permission, auto-refresh interval, and a test-query action. Auto-refresh defaults to `0`; when configured it only refreshes the provider currently selected in the UI.

The GUI and Gateway WebUI share the same provider settings shape and controls. The WebUI invokes the desktop query over the existing protobuf bridge and renders the returned cache state.

## Verification

Rust tests cover URL policy, template parsing, adapter request/response parsing, cache retention, and scripts. Gateway tests cover request forwarding and response routing. GUI and WebUI tests cover configuration normalization, stale-result rendering, manual refresh, and redacted settings synchronization. The final change runs applicable Rust, Go, GUI, WebUI, protocol, formatting, and diff checks.
