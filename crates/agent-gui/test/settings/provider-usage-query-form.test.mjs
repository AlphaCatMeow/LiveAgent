import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
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
};

test("usage query draft preserves configured redacted secrets when saved", () => {
  assert.equal(typeof forms.createUsageQueryDraft, "function");
  assert.equal(typeof forms.serializeUsageQueryDraft, "function");

  const draft = forms.createUsageQueryDraft(usageQuery, true);
  assert.notEqual(draft.accessToken, "");
  assert.notEqual(draft.secretAccessKey, "");

  assert.deepEqual(forms.serializeUsageQueryDraft(draft, true), usageQuery);
});

test("usage test action accepts only a persisted provider id", () => {
  assert.equal(typeof forms.getPersistedUsageQueryProviderId, "function");
  assert.equal(forms.getPersistedUsageQueryProviderId(undefined), null);
  assert.equal(forms.getPersistedUsageQueryProviderId({ id: "" }), null);
  assert.equal(forms.getPersistedUsageQueryProviderId({ id: "provider-a" }), "provider-a");
});

test("custom usage query needs confirmation before its first enabled save", () => {
  assert.equal(typeof forms.requiresCustomUsageQueryConfirmation, "function");
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
  assert.equal(
    forms.requiresCustomUsageQueryConfirmation({ ...usageQuery, enabled: false, mode: "custom" }, false),
    false,
  );
});
