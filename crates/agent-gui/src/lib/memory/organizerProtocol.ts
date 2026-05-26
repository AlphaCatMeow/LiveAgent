import type { MemoryBatchResponse, MemoryOrganizeRun, MemoryType } from "./api";

export type OrganizerRiskLevel = "low" | "medium" | "high";

export type OrganizerDecisionApplyStatus = "pending" | "applied" | "failed" | "skipped";

export type OrganizerSafeDecision = {
  op: "upsert" | "delete";
  slug: string;
  scope?: "global" | "project";
  workdirHash?: string;
  memoryType?: MemoryType;
  description?: string;
  body?: string;
  reason?: string;
  confidence?: number;
  riskLevel?: OrganizerRiskLevel;
  requiresUserAck?: boolean;
  sourceSlugs?: string[];
  evidencePreserved?: string[];
  blockedReasons?: string[];
  groupId?: string;
  applyStatus?: OrganizerDecisionApplyStatus;
  applyError?: OrganizerReviewItem;
};

export type OrganizerReviewItem = {
  phase: "planning" | "apply" | "system";
  kind: "review" | "skipped" | "warning" | "error";
  message: string;
  code?: string;
  slug?: string;
  op?: "upsert" | "delete";
  groupId?: string;
  decisionKey?: string;
  severity?: "info" | "warning" | "error";
  raw?: unknown;
};

export type OrganizerManualApplyStatus = "pending" | "applied" | "partial" | "failed" | "";

export type OrganizerManualApplyState = {
  status: OrganizerManualApplyStatus;
  appliedAt?: number;
  appliedDecisionKeys: Set<string>;
  failedDecisionKeys: Set<string>;
  selectedCount?: number;
  appliedCount?: number;
  warningCount?: number;
};

export type OrganizerProtocolObject = {
  version?: unknown;
  clusterSummaries?: unknown;
  reviewNotes?: unknown;
  reviewItems?: unknown;
  raw?: unknown;
  safeDecisions?: unknown;
  rejectionBuckets?: unknown;
  manualApplyState?: unknown;
};

export const ORGANIZER_PROTOCOL_VERSION = 2;

export function protocolObject(run: MemoryOrganizeRun | null): OrganizerProtocolObject {
  return run?.trimmedProtocol && typeof run.trimmedProtocol === "object"
    ? (run.trimmedProtocol as OrganizerProtocolObject)
    : {};
}

export function protocolStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function protocolStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

export function protocolNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function protocolRiskLevel(value: unknown): OrganizerRiskLevel | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

export function protocolRejectionBuckets(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const obj = value as Record<string, unknown>;
  return [
    ["settings.memoryOrganizerBucketReviewed", protocolNumber(obj.reviewedProtected) ?? 0],
    ["settings.memoryOrganizerBucketLowConfidence", protocolNumber(obj.lowConfidence) ?? 0],
    ["settings.memoryOrganizerBucketCrossType", protocolNumber(obj.crossType) ?? 0],
    ["settings.memoryOrganizerBucketCrossScope", protocolNumber(obj.crossScope) ?? 0],
    ["settings.memoryOrganizerBucketReviewRequired", protocolNumber(obj.reviewRequiredByLlm) ?? 0],
    ["settings.memoryOrganizerBucketMissingPayload", protocolNumber(obj.missingPayload) ?? 0],
    ["settings.memoryOrganizerBucketUnsupported", protocolNumber(obj.unsupported) ?? 0],
  ].filter(([, count]) => Number(count) > 0) as Array<[string, number]>;
}

export function protocolSafeDecisions(value: unknown): OrganizerSafeDecision[] {
  if (!Array.isArray(value)) return [];
  const out: OrganizerSafeDecision[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const op = obj.op === "delete" ? "delete" : obj.op === "upsert" ? "upsert" : null;
    const slug = typeof obj.slug === "string" ? obj.slug.trim() : "";
    if (!op || !slug) continue;
    const scope = obj.scope === "global" || obj.scope === "project" ? obj.scope : undefined;
    const memoryType =
      obj.memoryType === "user" ||
      obj.memoryType === "feedback" ||
      obj.memoryType === "project" ||
      obj.memoryType === "reference"
        ? obj.memoryType
        : undefined;
    out.push({
      op,
      slug,
      scope,
      workdirHash: typeof obj.workdirHash === "string" ? obj.workdirHash : undefined,
      memoryType,
      description: typeof obj.description === "string" ? obj.description : undefined,
      body: typeof obj.body === "string" ? obj.body : undefined,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
      confidence: protocolNumber(obj.confidence),
      riskLevel: protocolRiskLevel(obj.riskLevel),
      requiresUserAck: obj.requiresUserAck === true,
      sourceSlugs: protocolStringList(obj.sourceSlugs),
      evidencePreserved: protocolStringList(obj.evidencePreserved),
      blockedReasons: protocolStringList(obj.blockedReasons),
      groupId: typeof obj.groupId === "string" && obj.groupId.trim() ? obj.groupId : undefined,
      applyStatus:
        obj.applyStatus === "pending" ||
        obj.applyStatus === "applied" ||
        obj.applyStatus === "failed" ||
        obj.applyStatus === "skipped"
          ? obj.applyStatus
          : undefined,
      applyError:
        obj.applyError && typeof obj.applyError === "object" && !Array.isArray(obj.applyError)
          ? normalizeReviewItem(obj.applyError)
          : undefined,
    });
  }
  return out;
}

export function protocolManualApplyState(value: unknown): OrganizerManualApplyState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "",
      appliedDecisionKeys: new Set(),
      failedDecisionKeys: new Set(),
    };
  }
  const obj = value as Record<string, unknown>;
  const status =
    obj.status === "pending" ||
    obj.status === "applied" ||
    obj.status === "partial" ||
    obj.status === "failed"
      ? obj.status
      : "";
  return {
    status,
    appliedAt: protocolNumber(obj.appliedAt),
    appliedDecisionKeys: protocolStringSet(obj.appliedDecisionKeys),
    failedDecisionKeys: protocolStringSet(obj.failedDecisionKeys),
    selectedCount: protocolNumber(obj.selectedCount),
    appliedCount: protocolNumber(obj.appliedCount),
    warningCount: protocolNumber(obj.warningCount),
  };
}

export function organizerDecisionKey(decision: OrganizerSafeDecision, index: number) {
  return `${index}:${decision.op}:${decision.scope || ""}:${decision.workdirHash || ""}:${decision.slug}`;
}

export function isDefaultSelectedOrganizerDecision(decision: OrganizerSafeDecision) {
  return !decision.requiresUserAck && (decision.riskLevel ?? "low") === "low";
}

export function appliedBatchCount(
  batch: Pick<MemoryBatchResponse, "created" | "updated" | "deleted">,
) {
  return batch.created.length + batch.updated.length + batch.deleted.length;
}

export function inferOrganizerDecisionGroupIds<T extends OrganizerSafeDecision>(
  decisions: T[],
): T[] {
  const grouped = decisions.map((decision) => ({ ...decision }));
  for (const target of grouped) {
    if (
      target.op !== "upsert" ||
      target.groupId ||
      !target.sourceSlugs ||
      target.sourceSlugs.length < 2
    ) {
      continue;
    }
    const sourceSet = new Set(target.sourceSlugs.filter((slug) => slug && slug !== target.slug));
    if (sourceSet.size === 0) continue;
    const groupId = organizerGroupId(target);
    target.groupId = groupId;
    for (const candidate of grouped) {
      if (candidate.groupId || candidate.op !== "delete") continue;
      if (!sourceSet.has(candidate.slug)) continue;
      const candidateSources = new Set(candidate.sourceSlugs ?? []);
      if (candidateSources.size > 0 && !candidateSources.has(target.slug)) continue;
      candidate.groupId = groupId;
    }
  }
  return grouped as T[];
}

export function buildManualApplyState(input: {
  selectedCount: number;
  appliedCount: number;
  warningCount: number;
  appliedDecisionKeys: string[];
  failedDecisionKeys: string[];
}) {
  const status: Exclude<OrganizerManualApplyStatus, ""> =
    input.warningCount === 0 ? "applied" : input.appliedCount > 0 ? "partial" : "failed";
  return {
    status,
    appliedAt: Date.now(),
    selectedCount: input.selectedCount,
    appliedCount: input.appliedCount,
    warningCount: input.warningCount,
    appliedDecisionKeys: input.appliedDecisionKeys,
    failedDecisionKeys: input.failedDecisionKeys,
  };
}

export function buildReviewItemsForBatch(
  batch: MemoryBatchResponse,
  selectedWithKeys: Array<{ decision: OrganizerSafeDecision; key: string }>,
): OrganizerReviewItem[] {
  const warningDetails = Array.isArray(batch.warningDetails) ? batch.warningDetails : [];
  if (warningDetails.length > 0) {
    return warningDetails.map((detail, index) => {
      const item = normalizeReviewItem(detail, "apply");
      const detailDecisionIndex =
        typeof detail.decisionIndex === "number" && Number.isInteger(detail.decisionIndex)
          ? detail.decisionIndex
          : undefined;
      const fallback =
        detailDecisionIndex !== undefined
          ? selectedWithKeys[detailDecisionIndex]
          : selectedWithKeys[index];
      return {
        ...item,
        slug: item.slug ?? fallback?.decision.slug,
        op: item.op ?? fallback?.decision.op,
        groupId: item.groupId ?? fallback?.decision.groupId,
        decisionKey:
          item.decisionKey ?? decisionKeyForSlug(selectedWithKeys, item.slug) ?? fallback?.key,
      };
    });
  }
  return batch.warnings.map((warning, index) => {
    const parsed = parseWarningString(warning);
    const fallback = selectedWithKeys[index];
    return {
      ...parsed,
      slug: parsed.slug ?? fallback?.decision.slug,
      op: parsed.op ?? fallback?.decision.op,
      groupId: parsed.groupId ?? fallback?.decision.groupId,
      decisionKey: decisionKeyForSlug(selectedWithKeys, parsed.slug),
    };
  });
}

export function reviewItemsFromProtocol(protocol: OrganizerProtocolObject): OrganizerReviewItem[] {
  const structured = Array.isArray(protocol.reviewItems)
    ? protocol.reviewItems.map((item) => normalizeReviewItem(item)).filter((item) => item.message)
    : [];
  if (structured.length > 0) return structured;
  return protocolStringArray(protocol.reviewNotes).map((note) =>
    parseWarningString(note, "planning"),
  );
}

export function deriveManualApplyDisplay(input: {
  run: MemoryOrganizeRun | null;
  safeDecisions: OrganizerSafeDecision[];
  reviewItems: OrganizerReviewItem[];
  manualApplyState: OrganizerManualApplyState;
}) {
  const { run, safeDecisions, reviewItems, manualApplyState } = input;
  const applyItems = reviewItems.filter((item) => item.phase === "apply");
  const selectedCount = manualApplyState.selectedCount ?? safeDecisions.length;
  const appliedCount = manualApplyState.appliedCount ?? run?.safeApplied ?? 0;
  const warningCount = manualApplyState.warningCount ?? applyItems.length;
  let status = manualApplyState.status;
  if (status === "applied" && warningCount > 0) {
    status = appliedCount > 0 ? "partial" : "failed";
  }
  return {
    status,
    selectedCount,
    appliedCount,
    warningCount,
    failedDecisionKeys: manualApplyState.failedDecisionKeys,
    appliedDecisionKeys: manualApplyState.appliedDecisionKeys,
  };
}

export function successfulDecisionKeys(
  selectedWithKeys: Array<{ decision: OrganizerSafeDecision; key: string }>,
  batch: Pick<MemoryBatchResponse, "created" | "updated" | "deleted">,
) {
  const successfulSlugs = new Set([...batch.created, ...batch.updated, ...batch.deleted]);
  return selectedWithKeys
    .filter(({ decision }) => successfulSlugs.has(decision.slug))
    .map(({ key }) => key);
}

export function failedDecisionKeysFromReviewItems(
  selectedWithKeys: Array<{ decision: OrganizerSafeDecision; key: string }>,
  reviewItems: OrganizerReviewItem[],
) {
  const failedKeys = new Set(reviewItems.map((item) => item.decisionKey).filter(Boolean));
  const failedSlugs = new Set(reviewItems.map((item) => item.slug).filter(Boolean));
  return selectedWithKeys
    .filter(({ decision, key }) => failedKeys.has(key) || failedSlugs.has(decision.slug))
    .map(({ key }) => key);
}

export function decisionsWithApplyStatus(
  decisions: OrganizerSafeDecision[],
  manualApplyState: OrganizerManualApplyState,
  reviewItems: OrganizerReviewItem[],
) {
  const failedByKey = new Map<string, OrganizerReviewItem>();
  const failedBySlug = new Map<string, OrganizerReviewItem>();
  for (const item of reviewItems) {
    if (item.phase === "apply" && item.decisionKey) {
      failedByKey.set(item.decisionKey, item);
    }
    if (item.phase === "apply" && item.slug) {
      failedBySlug.set(item.slug, item);
    }
  }
  return decisions.map((decision, index) => {
    const key = organizerDecisionKey(decision, index);
    const failed =
      manualApplyState.failedDecisionKeys.has(key) ||
      failedByKey.get(key) ||
      failedBySlug.get(decision.slug);
    if (failed) {
      return {
        ...decision,
        applyStatus: "failed" as const,
        applyError: typeof failed === "object" ? failed : failedBySlug.get(decision.slug),
      };
    }
    if (manualApplyState.appliedDecisionKeys.has(key)) {
      return { ...decision, applyStatus: "applied" as const };
    }
    return decision;
  });
}

function protocolStringSet(value: unknown) {
  return new Set(protocolStringList(value));
}

function organizerGroupId(decision: OrganizerSafeDecision) {
  const scope = decision.scope || "";
  const workdir = decision.workdirHash || "";
  const sources = (decision.sourceSlugs ?? []).slice().sort().join("+");
  return `merge:${scope}:${workdir}:${decision.slug}:${sources}`;
}

function parseWarningString(
  input: string,
  fallbackPhase: OrganizerReviewItem["phase"] = "apply",
): OrganizerReviewItem {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    try {
      return normalizeReviewItem(JSON.parse(trimmed), fallbackPhase);
    } catch {
      // Fall through to plain-text handling.
    }
  }
  const failedPlan = /plan submission failed/i.test(trimmed);
  return {
    phase: failedPlan ? "planning" : fallbackPhase,
    kind: failedPlan ? "error" : fallbackPhase === "apply" ? "error" : "review",
    severity: failedPlan || fallbackPhase === "apply" ? "error" : "warning",
    message: trimmed,
    slug: slugFromText(trimmed),
    raw: input,
  };
}

function normalizeReviewItem(
  value: unknown,
  fallbackPhase: OrganizerReviewItem["phase"] = "planning",
): OrganizerReviewItem {
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const code = stringValue(obj.code) || stringValue(obj.error);
  const message =
    stringValue(obj.message) ||
    stringValue(obj.reason) ||
    stringValue(obj.error) ||
    JSON.stringify(value);
  const suggested =
    obj.suggested_next_call && typeof obj.suggested_next_call === "object"
      ? (obj.suggested_next_call as Record<string, unknown>)
      : obj.suggestedNextCall && typeof obj.suggestedNextCall === "object"
        ? (obj.suggestedNextCall as Record<string, unknown>)
        : {};
  const phase =
    obj.phase === "planning" || obj.phase === "apply" || obj.phase === "system"
      ? obj.phase
      : code
        ? "apply"
        : fallbackPhase;
  const kind =
    obj.kind === "review" ||
    obj.kind === "skipped" ||
    obj.kind === "warning" ||
    obj.kind === "error"
      ? obj.kind
      : code
        ? "error"
        : phase === "apply"
          ? "error"
          : "review";
  const severity =
    obj.severity === "info" || obj.severity === "warning" || obj.severity === "error"
      ? obj.severity
      : kind === "error"
        ? "error"
        : "warning";
  return {
    phase,
    kind,
    severity,
    code: code || undefined,
    message,
    slug:
      stringValue(obj.slug) || stringValue(suggested.slug) || slugFromText(message) || undefined,
    op:
      obj.op === "delete" || obj.action === "delete"
        ? "delete"
        : obj.op === "upsert" || obj.action === "update" || obj.action === "write"
          ? "upsert"
          : undefined,
    groupId: stringValue(obj.groupId) || stringValue(obj.group_id) || undefined,
    decisionKey: stringValue(obj.decisionKey) || stringValue(obj.decision_key) || undefined,
    raw: value,
  };
}

function decisionKeyForSlug(
  selectedWithKeys: Array<{ decision: OrganizerSafeDecision; key: string }>,
  slug: string | undefined,
) {
  if (!slug) return undefined;
  return selectedWithKeys.find(({ decision }) => decision.slug === slug)?.key;
}

function slugFromText(input: string) {
  return (
    /memory (?:body for|slug|file for slug) '([^']+)'/i.exec(input)?.[1] ||
    /slug[=:]\s*([a-z0-9_.:-]+)/i.exec(input)?.[1] ||
    ""
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
