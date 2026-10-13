import assert from "node:assert/strict";
import test from "node:test";
import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

function hookHarness() {
  let index = 0;
  const state = [];
  let pending;
  let previousDeps;
  let cleanup;
  const loader = createWebModuleLoader({ mocks: { react: {
    useState(initial) {
      const slot = index++;
      if (!(slot in state)) state[slot] = initial;
      return [state[slot], (value) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }];
    },
    useEffect(effect, deps) {
      if (!previousDeps || deps.some((value, i) => value !== previousDeps[i])) {
        pending = effect;
        previousDeps = deps;
      }
    },
  } } });
  const { useWebImageStudioHost } = loader.loadModule("src/agent-ui-adapters/imageStudio.ts");
  return {
    render(...args) { index = 0; return useWebImageStudioHost(...args); },
    flush() { if (pending) { cleanup?.(); cleanup = pending(); pending = undefined; } },
    dispose() { cleanup?.(); },
  };
}
const identity = { ownerId: "verified-user", backendId: "selected", gatewayOrigin: "https://gateway.example", accessToken: "login-token" };
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function withBrowser(run) {
  const properties = ["window", "localStorage", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  let storageReads = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: identity.gatewayOrigin } } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { storageReads++; return { getItem: () => null, setItem() { assert.fail("unexpected draft write"); }, removeItem() {} }; } });
  try { await run(() => storageReads); }
  finally {
    for (const [key, descriptor] of properties) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("actual no-identity hook exposes no client and never reads owner storage/network", async () => {
  await withBrowser(async (storageReads) => {
    globalThis.fetch = async () => assert.fail("must not invent an image backend");
    const hook = hookHarness();
    let view = hook.render("login-token", undefined, "/workspace");
    hook.flush();
    view = hook.render("login-token", undefined, "/workspace");
    assert.equal(view.host, undefined);
    assert.match(view.unavailable, /IMAGE_IDENTITY_UNAVAILABLE/);
    assert.equal(storageReads(), 0);
    hook.dispose();
  });
});

test("real 503 health response stays visible with manual retry and no available client", async () => {
  await withBrowser(async () => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      assert.equal(new URL(url).pathname, "/api/image/health");
      assert.equal(new URL(url).searchParams.get("backendId"), "selected");
      return Response.json({ version: "kbrain.image.v1", error: { code: "IMAGE_IDENTITY_UNAVAILABLE", message: "Not configured", requestId: "req-503", retryable: false } }, { status: 503 });
    };
    const hook = hookHarness();
    hook.render("login-token", identity, "/workspace");
    hook.flush();
    await tick();
    let view = hook.render("login-token", identity, "/workspace");
    assert.equal(view.host, undefined);
    assert.match(view.unavailable, /HTTP 503/);
    assert.match(view.unavailable, /IMAGE_IDENTITY_UNAVAILABLE/);
    assert.equal(calls, 1);
    view.retry();
    hook.render("login-token", identity, "/workspace");
    hook.flush();
    await tick();
    view = hook.render("login-token", identity, "/workspace");
    assert.equal(calls, 2);
    assert.equal(view.host, undefined);
    hook.dispose();
  });
});

test("identity/token/workspace switches synchronously hide stale host and abort its transport", async () => {
  await withBrowser(async () => {
    globalThis.fetch = async () => Response.json({ status: "ok", capabilities: { image: { supported: true, version: "kbrain.image.v1" } } });
    const hook = hookHarness();
    hook.render("login-token", identity, "/workspace");
    hook.flush();
    await tick();
    const ready = hook.render("login-token", identity, "/workspace");
    assert.ok(ready.host);
    const changed = hook.render("new-login", identity, "/other");
    assert.equal(changed.host, undefined);
    hook.flush();
    await assert.rejects(ready.host.client.listTargets(), { code: "IMAGE_ABORTED" });
    const rejected = hook.render("new-login", identity, "/other");
    assert.equal(rejected.host, undefined);
    assert.match(rejected.unavailable, /IMAGE_AUTH_REQUIRED/);
    const logout = hook.render("", undefined, "/workspace");
    assert.equal(logout.host, undefined);
    hook.flush();
    hook.dispose();
  });
});
