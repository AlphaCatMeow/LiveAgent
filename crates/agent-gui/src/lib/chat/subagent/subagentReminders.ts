import type { SubagentIdentityRecord, SubagentRunSummary } from "./subagentHistory";

const MAX_REMINDER_AGENTS = 12;
const MAX_REMINDER_FIELD_CHARS = 360;

function truncateReminderField(value: string, maxChars = MAX_REMINDER_FIELD_CHARS) {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function normalizeStatus(status: string) {
  return status === "completed" || status === "failed" || status === "cancelled"
    ? status
    : "running";
}

function latestRunsByLogicalAgent(runs: SubagentRunSummary[]) {
  const byId = new Map<string, SubagentRunSummary>();
  for (const run of runs.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))) {
    const id = run.logicalAgentId?.trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, run);
  }
  return byId;
}

export function buildExistingSubagentsReminder(
  identities: SubagentIdentityRecord[],
  runs: SubagentRunSummary[] = [],
) {
  const latestRuns = latestRunsByLogicalAgent(runs);
  const stableIdentities = identities.filter(
    (identity) => identity.logicalAgentId.trim() && identity.displayName.trim(),
  );
  if (stableIdentities.length === 0) return "";

  const agentLines = stableIdentities.slice(0, MAX_REMINDER_AGENTS).map((identity) => {
    const latestRun = latestRuns.get(identity.logicalAgentId);
    const fields = [
      `id=${identity.logicalAgentId}`,
      `name=${truncateReminderField(identity.displayName, 120)}`,
      `role=${truncateReminderField(identity.role, 160)}`,
      `mode=${identity.defaultMode}`,
    ];
    if (latestRun) {
      fields.push(
        `status=${normalizeStatus(latestRun.status)}`,
        `last_task=${truncateReminderField(latestRun.description)}`,
      );
      if (latestRun.summary) {
        fields.push(`last_summary=${truncateReminderField(latestRun.summary)}`);
      }
    }
    return `- ${fields.join(" ")}`;
  });

  if (stableIdentities.length > MAX_REMINDER_AGENTS) {
    agentLines.push(`- ... ${stableIdentities.length - MAX_REMINDER_AGENTS} more omitted`);
  }

  return [
    "Existing delegated agents in this parent conversation:",
    ...agentLines,
    "",
    "If the latest user message is addressed to these existing agents, experts, or the previous team, or asks what they think, asks them to answer a new question, continue, revise, compare, or discuss a follow-up, call Agent again with agent_spec blocks using the same id values. Do not impersonate those agents from the parent transcript. Agent resumes previous private context by default, so include only the new user request and any necessary parent-visible context in each resumed agent prompt. Set resume=false only when the user asks to replace, rebuild, or start fresh.",
    "For an existing delegated agent, do not restate name, role, or identity unless the user explicitly asks to create a new agent. LiveAgent will reuse the stored identity.",
    "For simple parent-level summaries of already returned reports, you may answer directly without calling Agent.",
  ].join("\n");
}
