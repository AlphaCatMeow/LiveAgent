import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const protocol = loader.loadModule("src/lib/memory/organizerProtocol.ts");

test("legacy reviewNotes raw JSON warnings become structured apply review items", () => {
  const rawWarning = JSON.stringify({
    error: "body_too_large",
    message: "memory body for slug 'travel-profile' exceeds the limit",
    suggested_next_call: { slug: "travel-profile" },
    action: "update",
  });

  const items = protocol.reviewItemsFromProtocol({ reviewNotes: [rawWarning] });

  assert.equal(items.length, 1);
  assert.equal(items[0].phase, "apply");
  assert.equal(items[0].kind, "error");
  assert.equal(items[0].severity, "error");
  assert.equal(items[0].code, "body_too_large");
  assert.equal(items[0].slug, "travel-profile");
  assert.equal(items[0].op, "upsert");
  assert.equal(items[0].message, "memory body for slug 'travel-profile' exceeds the limit");
});

test("legacy applied manual state is downgraded when apply warnings exist", () => {
  const manualApplyState = protocol.protocolManualApplyState({ status: "applied" });
  const reviewItems = [
    {
      phase: "apply",
      kind: "error",
      severity: "error",
      code: "body_too_large",
      message: "too large",
      slug: "travel-profile",
    },
  ];

  const partial = protocol.deriveManualApplyDisplay({
    run: { safeApplied: 2 },
    safeDecisions: [],
    reviewItems,
    manualApplyState,
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.appliedCount, 2);
  assert.equal(partial.warningCount, 1);

  const failed = protocol.deriveManualApplyDisplay({
    run: { safeApplied: 0 },
    safeDecisions: [],
    reviewItems,
    manualApplyState,
  });
  assert.equal(failed.status, "failed");
});

test("merge decisions infer a shared group id for target upsert and source deletes", () => {
  const decisions = protocol.inferOrganizerDecisionGroupIds([
    {
      op: "upsert",
      slug: "merged-profile",
      scope: "project",
      workdirHash: "abc",
      sourceSlugs: ["source-a", "source-b"],
    },
    {
      op: "delete",
      slug: "source-a",
      scope: "project",
      workdirHash: "abc",
      sourceSlugs: ["merged-profile"],
    },
    {
      op: "delete",
      slug: "unrelated",
      scope: "project",
      workdirHash: "abc",
    },
  ]);

  assert.ok(decisions[0].groupId);
  assert.equal(decisions[1].groupId, decisions[0].groupId);
  assert.equal(decisions[2].groupId, undefined);
});

test("structured batch warnings map decisionIndex back to the failed decision key", () => {
  const decisions = [
    { op: "upsert", slug: "first", scope: "project" },
    { op: "upsert", slug: "second", scope: "project" },
  ];
  const selectedWithKeys = decisions.map((decision, index) => ({
    decision,
    key: protocol.organizerDecisionKey(decision, index),
  }));
  const reviewItems = protocol.buildReviewItemsForBatch(
    {
      created: [],
      updated: ["first"],
      deleted: [],
      warnings: [],
      warningDetails: [
        {
          code: "body_too_large",
          message: "second is too large",
          slug: "second",
          op: "upsert",
          decisionIndex: 1,
        },
      ],
    },
    selectedWithKeys,
  );

  assert.equal(reviewItems.length, 1);
  assert.equal(reviewItems[0].decisionKey, selectedWithKeys[1].key);
  assert.deepEqual(protocol.failedDecisionKeysFromReviewItems(selectedWithKeys, reviewItems), [
    selectedWithKeys[1].key,
  ]);
});
