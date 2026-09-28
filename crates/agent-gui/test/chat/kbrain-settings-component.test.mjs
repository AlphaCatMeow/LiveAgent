import assert from "node:assert/strict";
import test from "node:test";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

test("K-brain settings isolates clear-key and pending new-provider key per provider", async () => {
  const env = await createDomTestEnv({
    mocks: {
      "@liveagent/ui/i18n/index": { useLocale: () => ({ t: (key) => key }) },
    },
  });
  const calls = [];
  const documentValue = {
    mode: "kbrain",
    defaultModel: "model-a",
    defaultProvider: "provider-a",
    providers: [
      { id: "provider-a", name: "A", api: "openai-completions", baseUrl: "https://a.invalid/v1", apiKeyConfigured: true, models: [{ provider: "provider-a", id: "model-a" }] },
      { id: "provider-b", name: "B", api: "openai-completions", baseUrl: "https://b.invalid/v1", apiKeyConfigured: true, models: [{ provider: "provider-b", id: "model-b" }] },
    ],
    models: [],
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init?.method === "PUT") return new Response(JSON.stringify(documentValue), { status: 200 });
    return new Response(JSON.stringify(documentValue), { status: 200 });
  };
  const { KBrainSettingsSection } = env.loadModule("@liveagent/ui/pages/settings/KBrainSettingsSection.tsx");
  const host = document.body.appendChild(document.createElement("div"));
  const root = env.createRoot(host);
  const clickButton = async (text) => {
    const button = [...host.querySelectorAll("button")].find((node) => node.textContent.trim() === text);
    assert.ok(button, `missing button ${text}`);
    await env.act(async () => button.click());
  };
  try {
    await env.act(async () => root.render(env.React.createElement(KBrainSettingsSection, { settings: {}, setSettings: () => {} })));
    await env.act(async () => Promise.resolve());
    assert.equal(host.querySelector("#kbrain-clear-key").checked, false);

    await env.act(async () => host.querySelector("#kbrain-clear-key").click());
    assert.equal(host.querySelector("#kbrain-clear-key").checked, true);
    await clickButton("B");
    assert.equal(host.querySelector("#kbrain-clear-key").checked, false, "switching providers clears the active checkbox");
    await clickButton("settings.save");
    const firstPut = JSON.parse(calls.find((call) => call.init?.method === "PUT").init.body);
    const providerB = firstPut.providers.find((provider) => provider.id === "provider-b");
    assert.equal(Object.hasOwn(providerB, "clearApiKey"), false, "A's clear flag must not apply to B");

    await clickButton("A");
    assert.equal(host.querySelector("#kbrain-clear-key").checked, true, "A's pending clear remains isolated");
    await clickButton("settings.save");
    const puts = calls.filter((call) => call.init?.method === "PUT");
    const providerA = JSON.parse(puts.at(-1).init.body).providers.find((provider) => provider.id === "provider-a");
    assert.equal(providerA.clearApiKey, true);

    const idInput = host.querySelector('input[aria-label="settings.kbrainProviderId"]');
    const nameInput = host.querySelector('input[aria-label="settings.kbrainProviderName"]');
    const baseInput = host.querySelector('input[aria-label="settings.kbrainBaseUrl"]');
    const keyInput = host.querySelector('input[aria-label="settings.kbrainApiKey"]');
    const setValue = async (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      await env.act(async () => { setter.call(input, value); input.dispatchEvent(new window.Event("input", { bubbles: true })); });
    };
    await setValue(idInput, "provider-new");
    await setValue(nameInput, "New");
    await setValue(baseInput, "https://new.invalid/v1");
    await setValue(keyInput, "new-provider-key");
    await clickButton("settings.kbrainAddProvider");
    await clickButton("B");
    await clickButton("settings.save");
    const lastPut = JSON.parse(calls.filter((call) => call.init?.method === "PUT").at(-1).init.body);
    const providerBAfterNew = lastPut.providers.find((provider) => provider.id === "provider-b");
    assert.equal(Object.hasOwn(providerBAfterNew, "apiKey"), false, "new provider key must not transfer to B");
  } finally {
    await env.act(async () => root.unmount());
    host.remove();
    globalThis.fetch = previousFetch;
    env.cleanup();
  }
});
