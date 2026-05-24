import { DEFAULT_SUBAGENT_MAX_PARALLEL_RUNS } from "../../chat/subagent/subagentScheduler";

export const DELEGATE_TOOL_NAME = "Agent";

export const MAX_AGENTS = DEFAULT_SUBAGENT_MAX_PARALLEL_RUNS;
export const MAX_CONCURRENCY = MAX_AGENTS;
export const DEFAULT_CONCURRENCY = MAX_CONCURRENCY;
export const MAX_SUMMARY_CHARS = 8_000;
export const MAX_DIFF_CHARS = 20_000;
export const TEXT_DELTA_EVENT_CHUNK_CHARS = 2_000;
export const THINKING_DELTA_EVENT_CHUNK_CHARS = 2_000;
