# Provider Usage Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, API-only provider balance and Coding Plan quota queries to desktop and Gateway WebUI provider settings.

**Architecture:** The desktop Rust process reads stored provider credentials and owns query execution plus an in-memory keep-last-good cache. GUI and WebUI share a `usageQuery` setting; WebUI invokes the desktop through a new protobuf envelope and never receives query credentials. Built-in adapters cover CC-Switch-compatible balance and Coding Plan hosts, while generic templates use a two-phase QuickJS request/extractor sandbox.

**Tech Stack:** Rust/Tauri, reqwest, rquickjs, protobuf/Buf, Go Gateway, React/TypeScript, Node test runner.

## Global Constraints

- Support only LiveAgent provider types: `claude_code`, `codex`, `gemini`, and `xai`.
- Do not read CLI credential files or implement OAuth/subscription quota queries.
- Default `enabled` is `false`; default `autoRefreshMinutes` is `0`.
- Standard templates require HTTPS and the configured Base URL origin; custom templates may cross origin but must pass destination policy.
- Reject URL credentials and loopback, link-local, private, carrier-grade NAT, and cloud-metadata addresses unless `allowLocalNetwork` is true.
- Keep API keys and query secrets out of Gateway snapshots, WebUI storage, errors, and logs.

---

### Task 1: Define and normalize shared settings

**Files:**
- Modify: `crates/agent-gui/src/lib/settings/index.ts`
- Modify: `crates/agent-gui/src/lib/settings/normalize.ts`
- Modify: `crates/agent-gui/src/lib/settings/sync.ts`
- Modify: `crates/agent-gateway/web/src/lib/settings/index.ts`
- Modify: `crates/agent-gateway/web/src/lib/settings/normalize.ts`
- Modify: `crates/agent-gateway/web/src/lib/settings/sync.ts`
- Test: `crates/agent-gui/test/settings/normalization.test.mjs`
- Test: `crates/agent-gateway/test/webui/settings-sync.test.mjs`

**Interfaces:**
- Produces `UsageQueryConfig`, `UsageQueryMode`, and `UsageQuerySecretUpdate` used by UI and Rust JSON decoding.
- Produces gateway-redacted query configuration and a one-way secret-update side channel.

- [ ] **Step 1: Write failing settings tests**

```js
test("usage query defaults disabled and redacts query credentials", () => {
  const provider = settings.normalizeCustomProvider({ usageQuery: { mode: "newapi", accessToken: "t", secretAccessKey: "s" } });
  assert.equal(provider.usageQuery.enabled, false);
  const redacted = sync.redactCustomProvidersForGateway([provider])[0];
  assert.equal(redacted.usageQuery.accessToken, "");
  assert.equal(redacted.usageQuery.secretAccessKey, "");
  assert.equal(redacted.usageQuery.accessTokenConfigured, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C crates/agent-gui test:frontend -- test/settings/normalization.test.mjs`

Expected: FAIL because `usageQuery` is absent.

- [ ] **Step 3: Add minimal mirrored settings contracts**

```ts
export type UsageQueryMode = "balance" | "coding-plan" | "general" | "newapi" | "custom";
export type UsageQueryConfig = {
  enabled: boolean;
  mode: UsageQueryMode;
  script: string;
  baseUrl: string;
  accessToken: string;
  accessTokenConfigured?: boolean;
  userId: string;
  accessKeyId: string;
  secretAccessKey: string;
  secretAccessKeyConfigured?: boolean;
  autoRefreshMinutes: number;
  allowLocalNetwork: boolean;
};

export type UsageQuerySecretUpdate = {
  accessToken?: string;
  secretAccessKey?: string;
};
```

Normalize invalid modes to `balance`, cap auto-refresh at 1440 minutes, preserve absent legacy settings, redact the two query secrets, and merge non-redacted secret updates without overwriting an existing stored secret with a redacted empty value.

- [ ] **Step 4: Re-run GUI and WebUI settings tests**

Run: `pnpm -C crates/agent-gui test:frontend -- test/settings/normalization.test.mjs && pnpm -C crates/agent-gateway/web test -- ../test/webui/settings-sync.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-gui/src/lib/settings crates/agent-gateway/web/src/lib/settings crates/agent-gui/test/settings/normalization.test.mjs crates/agent-gateway/test/webui/settings-sync.test.mjs
git commit -m "feat(settings): add provider usage query configuration"
```

### Task 2: Build the secure Rust query service

**Files:**
- Modify: `crates/agent-gui/src-tauri/Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `crates/agent-gui/src-tauri/src/services/mod.rs`
- Create: `crates/agent-gui/src-tauri/src/services/provider_usage.rs`

**Interfaces:**
- Produces `ProviderUsageService::query(provider_id, force)` and `ProviderUsageResult` serialized as camelCase JSON.
- Consumes normalized provider JSON stored by the existing settings database.

- [ ] **Step 1: Write failing service tests**

```rust
#[test]
fn rejects_private_and_credentialed_destinations() {
    assert!(validate_destination("https://user:pass@example.test", false).is_err());
    assert!(validate_destination("https://169.254.169.254/latest", false).is_err());
    assert!(validate_destination("https://127.0.0.1", false).is_err());
}

#[test]
fn cache_preserves_last_good_result_on_failure() {
    let mut cache = UsageCache::default();
    cache.record_success("p", result("$4.20"));
    cache.record_failure("p", "timeout");
    assert!(cache.get("p").unwrap().is_stale);
    assert_eq!(cache.get("p").unwrap().entries[0].value, "$4.20");
}
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run: `cargo test --manifest-path crates/agent-gui/src-tauri/Cargo.toml provider_usage`

Expected: FAIL because the service module is missing.

- [ ] **Step 3: Implement the query engine**

Add `rquickjs = { version = "0.8", features = ["array-buffer", "classes"] }`. Implement bounded request parsing and extraction without exposing a `fetch`, filesystem, process, module loader, or host callbacks to JavaScript. The accepted script evaluates to:

```js
({ request: { url, method, headers, body }, extractor: (response) => ({ remaining, unit }) })
```

Use provider credentials only after loading them from the desktop database. Support these adapters: balances for DeepSeek, StepFun, SiliconFlow CN/EN, OpenRouter, and Novita; Coding Plan quotas for Kimi, Zhipu CN/EN, MiniMax CN/EN, ZenMux, and Volcengine when `accessKeyId` and `secretAccessKey` are configured. Convert all results into:

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageResult {
    pub entries: Vec<ProviderUsageEntry>,
    pub queried_at: Option<i64>,
    pub error: Option<String>,
    pub is_stale: bool,
}
```

- [ ] **Step 4: Run focused Rust tests**

Run: `cargo test --manifest-path crates/agent-gui/src-tauri/Cargo.toml provider_usage`

Expected: PASS, including adapter parsing, templates, destination policy, script result validation, and cache retention.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-gui/src-tauri/Cargo.toml Cargo.lock crates/agent-gui/src-tauri/src/services
git commit -m "feat(provider): add secure usage query service"
```

### Task 3: Expose desktop and Gateway query RPCs

**Files:**
- Modify: `crates/agent-gateway/proto/v2/gateway.proto`
- Modify: `crates/agent-gateway/internal/protocol/pbws/guard.go`
- Modify: `crates/agent-gui/src-tauri/src/lib.rs`
- Modify: `crates/agent-gui/src-tauri/src/commands/integration/gateway.rs`
- Modify: `crates/agent-gui/src-tauri/src/services/gateway_bridge.rs`
- Modify: `crates/agent-gui/src-tauri/src/services/gateway/envelope_handler.rs`
- Modify: generated `crates/agent-gateway/internal/proto/v2/*` and `crates/agent-gateway/web/src/lib/proto/gen/*`
- Test: `crates/agent-gui/src-tauri/src/services/gateway/tests.rs`
- Test: `crates/agent-gateway/internal/protocol/pbws/guard_test.go`

**Interfaces:**
- Adds `ProviderUsageRequest { string provider_id = 1; bool refresh = 2; }` and `ProviderUsageResponse { string result_json = 1; }` as new, append-only envelope fields.
- Adds a local Tauri `provider_usage_query(provider_id, refresh)` command with the same result JSON.

- [ ] **Step 1: Write failing forwarding and guard tests**

```go
func TestVetAgentRequestAllowsProviderUsage(t *testing.T) {
  env := &gatewayv2.GatewayEnvelope{Payload: &gatewayv2.GatewayEnvelope_ProviderUsage{ProviderUsage: &gatewayv2.ProviderUsageRequest{ProviderId: "p", Refresh: true}}}
  require.NoError(t, vetAgentRequest(testAgentView{}, env))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go -C crates/agent-gateway test ./internal/protocol/pbws -run ProviderUsage`

Expected: FAIL because generated types do not exist.

- [ ] **Step 3: Add append-only protocol and handlers**

Reserve no existing field numbers. Add request/response fields after the current highest field, run `make proto`, allow the request in `vetAgentRequest`, and route the envelope to `ProviderUsageService`. Emit only the serialized result, never provider configuration or credentials.

- [ ] **Step 4: Run protocol checks**

Run: `make proto-check && cargo test --manifest-path crates/agent-gui/src-tauri/Cargo.toml gateway && go -C crates/agent-gateway test ./internal/protocol/pbws -run ProviderUsage`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-gateway/proto crates/agent-gateway/internal/proto crates/agent-gateway/web/src/lib/proto crates/agent-gateway/internal/protocol crates/agent-gui/src-tauri/src
git commit -m "feat(gateway): relay provider usage queries"
```

### Task 4: Add mirrored query client, card state, and auto-refresh

**Files:**
- Create: `crates/agent-gui/src/lib/providers/usageQuery.ts`
- Create: `crates/agent-gateway/web/src/lib/providers/usageQuery.ts`
- Modify: `crates/agent-gui/src/pages/settings/ProvidersSection.tsx`
- Modify: `crates/agent-gateway/web/src/pages/settings/ProvidersSection.tsx`
- Modify: `crates/agent-gateway/web/src/lib/gatewaySocketV2/adapters.ts`
- Test: `crates/agent-gui/test/settings/provider-usage-query.test.mjs`
- Test: `crates/agent-gateway/test/webui/provider-usage-query.test.mjs`

**Interfaces:**
- `queryProviderUsage(providerId, refresh): Promise<ProviderUsageResult | null>` calls Tauri locally or `provider.usage.query` through the Gateway.
- `useProviderUsage` keeps client display state synchronized with the desktop cache.

- [ ] **Step 1: Write failing frontend behavior tests**

```js
test("failed refresh retains prior values and marks result stale", () => {
  const state = usage.reduceUsageState({}, { providerId: "p", result: { entries: [{ label: "USD", value: "4.20" }], isStale: false } });
  const next = usage.reduceUsageState(state, { providerId: "p", error: "timeout" });
  assert.equal(next.p.entries[0].value, "4.20");
  assert.equal(next.p.isStale, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C crates/agent-gui test:frontend -- test/settings/provider-usage-query.test.mjs`

Expected: FAIL because the helper module is missing.

- [ ] **Step 3: Implement the query client and card display**

Map `provider.usage.query` to the protobuf request in the WebUI adapter. Provider cards render values, stale/error metadata, update time, and a `RefreshCw` icon button. The refresh action queries one provider only. A timer starts only when the selected model's provider has an enabled nonzero interval; it is cleaned up on selection/configuration change.

- [ ] **Step 4: Run mirrored tests and mirror validation**

Run: `pnpm -C crates/agent-gui test:frontend -- test/settings/provider-usage-query.test.mjs && pnpm -C crates/agent-gateway/web test -- ../test/webui/provider-usage-query.test.mjs && node scripts/check-mirror.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-gui/src/lib/providers crates/agent-gateway/web/src/lib/providers crates/agent-gui/src/pages/settings/ProvidersSection.tsx crates/agent-gateway/web/src/pages/settings/ProvidersSection.tsx crates/agent-gateway/web/src/lib/gatewaySocketV2/adapters.ts crates/agent-gui/test/settings crates/agent-gateway/test/webui
git commit -m "feat(providers): display usage query results"
```

### Task 5: Add configuration and test-query controls

**Files:**
- Modify: `crates/agent-gui/src/pages/settings/ProvidersSection.tsx`
- Modify: `crates/agent-gateway/web/src/pages/settings/ProvidersSection.tsx`
- Modify: `crates/agent-gui/src/i18n/config.ts`
- Test: `crates/agent-gui/test/i18n/translations.test.mjs`

**Interfaces:**
- Provider modal saves `usageQuery` with the normal provider transaction.
- Test action queries only a persisted provider ID, preserving the desktop-only credential boundary.

- [ ] **Step 1: Write failing settings tests**

```js
test("usage query labels exist in both locales", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    assert.ok(translations[locale]["settings.providerUsageQuery"]);
    assert.ok(translations[locale]["settings.providerUsageTest"]);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C crates/agent-gui test:frontend -- test/i18n/translations.test.mjs`

Expected: FAIL because query translation keys do not exist.

- [ ] **Step 3: Implement the controls**

Add a Usage panel with the enabled switch, mode select, optional template/script text area, NewAPI fields, Coding Plan credentials, local-network toggle, interval input, and test icon/button. Show the one-time custom-query security confirmation before persisting `enabled: true`. Reuse the existing modal controls and mirror every changed UI branch into the WebUI copy.

- [ ] **Step 4: Run focused UI checks**

Run: `pnpm -C crates/agent-gui test:frontend -- test/i18n/translations.test.mjs && pnpm -C crates/agent-gui lint && pnpm -C crates/agent-gateway/web lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/agent-gui/src/pages/settings/ProvidersSection.tsx crates/agent-gateway/web/src/pages/settings/ProvidersSection.tsx crates/agent-gui/src/i18n/config.ts crates/agent-gui/test/i18n/translations.test.mjs
git commit -m "feat(providers): configure usage queries"
```

### Task 6: Finish contributor guide and verify all affected surfaces

**Files:**
- Add: `AGENTS.md`

- [ ] **Step 1: Verify the contributor guide**

Run: `wc -w AGENTS.md && sed -n '1,220p' AGENTS.md`

Expected: 200-400 words with repository-specific build, test, style, and PR guidance.

- [ ] **Step 2: Run full validation**

Run:

```bash
cargo fmt --manifest-path crates/agent-gui/src-tauri/Cargo.toml --check
cargo test --manifest-path crates/agent-gui/src-tauri/Cargo.toml
go -C crates/agent-gateway test ./...
pnpm -C crates/agent-gui test:frontend
pnpm -C crates/agent-gui build
pnpm -C crates/agent-gateway/web test
pnpm -C crates/agent-gateway/web build
make proto-check
node scripts/check-mirror.mjs
git diff --check
```

Expected: every command exits 0. Cross-compilation commands will be run for installed macOS, Windows, and Linux targets; unavailable host SDKs are reported explicitly rather than hidden.

- [ ] **Step 3: Commit final documentation and validation fixes**

```bash
git add AGENTS.md
git commit -m "docs: add contributor guidelines"
```
