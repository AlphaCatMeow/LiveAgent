import assert from "node:assert/strict";
import test from "node:test";
import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

const loader = createWebModuleLoader();
const forms = loader.loadModule("src/pages/settings/providerUtils.ts");

const usageQuery = {
  enabled: true,
  mode: "newapi",
  script: "",
  baseUrl: "https://usage.example.test",
  accessToken: "",
  accessTokenConfigured: true,
  userId: "user-1",
  accessKeyId: "key-1",
  secretAccessKey: "",
  secretAccessKeyConfigured: true,
  autoRefreshMinutes: 15,
  allowLocalNetwork: false,
};

test("WebUI usage query draft preserves configured redacted secrets when saved", () => {
  const draft = forms.createUsageQueryDraft(usageQuery, true);

  assert.notEqual(draft.accessToken, "");
  assert.notEqual(draft.secretAccessKey, "");
  assert.deepEqual(forms.serializeUsageQueryDraft(draft, true), usageQuery);
});

test("WebUI usage test action accepts only a persisted provider id", () => {
  assert.equal(forms.getPersistedUsageQueryProviderId(undefined), null);
  assert.equal(forms.getPersistedUsageQueryProviderId({ id: "" }), null);
  assert.equal(forms.getPersistedUsageQueryProviderId({ id: "provider-a" }), "provider-a");
});

test("WebUI custom usage query needs confirmation before its first enabled save", () => {
  assert.equal(
    forms.requiresCustomUsageQueryConfirmation({ ...usageQuery, mode: "custom" }, false),
    true,
  );
  assert.equal(
    forms.requiresCustomUsageQueryConfirmation({ ...usageQuery, mode: "custom" }, true),
    false,
  );
  assert.equal(
    forms.requiresCustomUsageQueryConfirmation({ ...usageQuery, mode: "custom", enabled: true }, true),
    false,
  );
});
