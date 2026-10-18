export type ToolRootAccess = "read" | "write";

/**
 * A tool call the backend paused because its path is outside the run's
 * authorized workspace roots (or targets a read-only root). The call resumes
 * once the user grants a directory or denies the request.
 */
export type ToolRootRequest = {
  code: "path_outside_roots" | "path_read_only_root";
  /** Resolved absolute path the tool asked for. */
  path: string;
  access: ToolRootAccess;
};

/** Where an approved grant is stored. `turn` only extends the running turn. */
export type ToolRootGrantScope = "turn" | "project" | "repository" | "global";

export type ToolRootDecision =
  | { decision: "grant"; scope: ToolRootGrantScope; access: ToolRootAccess }
  | { decision: "deny" };

/** `directory` is the granted directory (the nearest existing one of `path`). */
export type ToolRootAnswerOutcome = { directory?: string };

export type ToolRootRequestAnswerer = (
  toolCallId: string,
  decision: ToolRootDecision,
) => Promise<ToolRootAnswerOutcome>;
