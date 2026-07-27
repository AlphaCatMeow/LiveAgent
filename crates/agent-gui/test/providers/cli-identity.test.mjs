import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const core = loader.loadModule("src/lib/providers/cliIdentityCore.ts");
const headers = loader.loadModule("src/lib/providers/customHeaders.ts");
const settings = loader.loadModule("src/lib/settings/index.ts");

test("CLI 身份默认值与 UA 模板保持供应商协议语义", () => {
  const profiles = core.getDefaultCliIdentitySettings();
  assert.equal(profiles.claude_code.mode, "notify");
  assert.equal(profiles.claude_code.version, "2.1.71");
  assert.equal(
    core.formatCliIdentityUserAgent("claude_code", "2.1.212"),
    "claude-cli/2.1.212 (external, cli)",
  );
  assert.equal(
    core.formatCliIdentityUserAgent("codex", "0.145.0"),
    "codex_cli_rs/0.145.0 (Ubuntu 24.4.0; x86_64) WindowsTerminal",
  );
  assert.equal(
    core.formatCliIdentityUserAgent("xai", "0.2.112"),
    "grok-shell/0.2.112 (linux; x86_64)",
  );
});

test("CLI 身份只接受稳定 SemVer 并按数值比较", () => {
  assert.equal(core.normalizeStableCliVersion(" 0.145.0 "), "0.145.0");
  assert.equal(core.normalizeStableCliVersion("0.146.0-alpha.1"), undefined);
  assert.equal(core.normalizeStableCliVersion("01.2.3"), undefined);
  assert.equal(core.compareCliVersions("0.145.0", "0.72.0"), 73);
  assert.equal(core.compareCliVersions("2.1.10", "2.1.9") > 0, true);
  assert.equal(core.compareCliVersions("2.1.9", "2.1.9"), 0);
});

test("CLI 身份支持确认应用、自动模式、内置模式与单步回滚", () => {
  const initial = core.getDefaultCliIdentitySettings().codex;
  const updated = core.applyCliIdentityVersion(initial, "0.145.0");
  assert.equal(updated.version, "0.145.0");
  assert.equal(updated.previousVersion, "0.72.0");
  assert.equal(core.cliIdentityUpdateAvailable("codex", updated), false);

  const rolledBack = core.rollbackCliIdentityVersion(updated);
  assert.equal(rolledBack.version, "0.72.0");
  assert.equal(rolledBack.previousVersion, "0.145.0");

  const builtin = core.setCliIdentityMode("codex", updated, "builtin");
  assert.equal(core.getAppliedCliIdentityVersion("codex", builtin), "0.72.0");
  assert.equal(core.setCliIdentityMode("codex", builtin, "auto").mode, "auto");
});

test("设置规范化补齐身份配置并过滤非法远端版本", () => {
  const defaults = settings.normalizeSettings({ customSettings: {} });
  assert.equal(defaults.customSettings.providerIdentities.codex.version, "0.72.0");

  const normalized = settings.normalizeSettings({
    customSettings: {
      providerIdentities: {
        codex: {
          mode: "auto",
          version: "0.145.0",
          previousVersion: "0.72.0",
          latestVersion: "0.146.0-alpha.1",
          lastCheckedAt: 1234,
        },
      },
    },
  });
  assert.equal(normalized.customSettings.providerIdentities.codex.mode, "auto");
  assert.equal(normalized.customSettings.providerIdentities.codex.version, "0.145.0");
  assert.equal(normalized.customSettings.providerIdentities.codex.latestVersion, undefined);
  assert.equal(normalized.customSettings.providerIdentities.codex.lastCheckedAt, 1234);
});

test("全局身份只填补默认 UA，自定义覆盖和协议例外保持优先", () => {
  const identities = core.getDefaultCliIdentitySettings();
  identities.codex = core.applyCliIdentityVersion(identities.codex, "0.145.0");

  const managed = headers.resolveProviderCustomHeaders(
    {
      type: "codex",
      apiKey: "secret",
      requestFormat: "openai-responses",
      customHeaders: [{ key: "X-Environment", value: "test" }],
    },
    identities,
  );
  assert.deepEqual(managed, [
    {
      key: "User-Agent",
      value: "codex_cli_rs/0.145.0 (Ubuntu 24.4.0; x86_64) WindowsTerminal",
    },
    { key: "X-Environment", value: "test" },
  ]);

  const custom = [{ key: "user-agent", value: "relay-client/3.2.1" }];
  assert.equal(
    headers.resolveProviderCustomHeaders(
      { type: "codex", apiKey: "secret", requestFormat: "openai-responses", customHeaders: custom },
      identities,
    ),
    custom,
  );
  assert.deepEqual(
    headers.resolveProviderCustomHeaders(
      { type: "codex", apiKey: "secret", requestFormat: "openai-completions", customHeaders: [] },
      identities,
    ),
    [],
  );
  assert.deepEqual(
    headers.resolveProviderCustomHeaders(
      { type: "claude_code", apiKey: "sk-ant-oat-test", customHeaders: [] },
      identities,
    ),
    [],
  );
});

test("在线检查使用固定官方包和稳定 dist-tag，单个失败不阻塞其它供应商", async () => {
  const rootDir = fileURLToPath(new URL("../..", import.meta.url));
  const hubFetchPath = path.join(rootDir, "src/lib/hubFetch.ts");
  const requested = [];
  const networkLoader = createTsModuleLoader({
    mocks: {
      [hubFetchPath]: {
        async hubFetch(url) {
          requested.push(url);
          if (url.includes("anthropic-ai")) {
            return new Response(JSON.stringify({ stable: "2.1.212", latest: "2.1.220" }));
          }
          if (url.includes("openai")) {
            return new Response(JSON.stringify({ latest: "0.146.0-alpha.1" }));
          }
          return new Response(JSON.stringify({ latest: "0.2.112" }));
        },
      },
    },
  });
  const updates = networkLoader.loadModule("src/lib/providers/cliIdentityUpdates.ts");
  const results = await updates.checkCliIdentityVersions(["claude_code", "codex", "xai"]);

  assert.equal(results[0].status, "success");
  assert.equal(results[0].version, "2.1.212");
  assert.equal(results[1].status, "error");
  assert.match(results[1].message, /stable semantic version/);
  assert.equal(results[2].status, "success");
  assert.equal(results[2].version, "0.2.112");
  assert.equal(requested.length, 3);
  assert.ok(requested.every((url) => url.startsWith("https://registry.npmjs.org/-/package/")));
});
