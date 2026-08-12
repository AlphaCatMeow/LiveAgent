export type ProjectToolTextGenerationRequest = {
  systemPrompt: string;
  userPrompt: string;
  output: "text" | "json";
  signal?: AbortSignal;
};

export type ProjectToolTextGenerationClient = {
  generate(request: ProjectToolTextGenerationRequest): Promise<string>;
};
