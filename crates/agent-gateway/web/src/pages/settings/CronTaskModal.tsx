import { useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Globe,
  MessageSquare,
  Plus,
  Terminal,
  Trash2,
  X,
} from "../../components/icons";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { parseModelValue, toModelValue } from "../../lib/providers/llm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useLocale } from "../../i18n";
import { useModalMotion } from "../../lib/shared/modalMotion";
import {
  canHookHttpMethodHaveBody,
  HOOK_HTTP_METHODS,
  type CronTask,
  type CronTaskType,
  type ExecutionMode,
  type HookHttpMethod,
  isAgentExecutionMode,
} from "../../lib/settings";
import {
  createEmptyTaskRequestDraft,
  parseHttpRequests,
  taskRequestToDraft,
  type TaskHttpRequestDraft,
} from "./taskConfigUtils";

export type { CronTask, CronTaskType } from "../../lib/settings";
export type CronHttpRequestDraft = TaskHttpRequestDraft;

type CronPromptModelOption = {
  value: string;
  label: string;
  providerName: string;
};

type CronTaskModalProps = {
  mode: "add" | "edit";
  initialData?: CronTask;
  modelOptions: CronPromptModelOption[];
  executionMode: ExecutionMode;
  onSave: (data: Omit<CronTask, "id">) => void | Promise<void>;
  onClose: () => void;
};

function createEmptyRequestDraft(): CronHttpRequestDraft {
  return createEmptyTaskRequestDraft();
}

export function CronTaskModal({
  mode,
  initialData,
  modelOptions,
  executionMode,
  onSave,
  onClose,
}: CronTaskModalProps) {
  const { t } = useLocale();
  const autoPromptSupported = isAgentExecutionMode(executionMode);

  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [cron, setCron] = useState(initialData?.cron ?? "");
  const [remainingExecutions, setRemainingExecutions] = useState(
    initialData?.remainingExecutions == null ? "" : String(initialData.remainingExecutions),
  );
  const [type, setType] = useState<CronTaskType>(initialData?.type ?? "bash");
  const [scriptText, setScriptText] = useState(initialData?.script ?? "");
  const [requests, setRequests] = useState<CronHttpRequestDraft[]>(() => {
    if (initialData?.requests?.length) {
      return initialData.requests.map((request) => taskRequestToDraft(request));
    }
    return [createEmptyRequestDraft()];
  });
  const [prompt, setPrompt] = useState(initialData?.prompt ?? "");
  const [selectedModelValue, setSelectedModelValue] = useState(() =>
    initialData?.selectedModel
      ? toModelValue(
          initialData.selectedModel.customProviderId,
          initialData.selectedModel.model,
        )
      : "",
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { isClosing, modalState, requestClose } = useModalMotion(onClose);

  const promptModelOptions = selectedModelValue &&
    !modelOptions.some((option) => option.value === selectedModelValue) &&
    initialData?.selectedModel
    ? [
        ...modelOptions,
        {
          value: selectedModelValue,
          label: initialData.selectedModel.model,
          providerName: initialData.selectedModel.customProviderId,
        },
      ]
    : modelOptions;

  const selectedPromptModel =
    promptModelOptions.find((option) => option.value === selectedModelValue) ?? null;

  function updateRequest(id: string, patch: Partial<CronHttpRequestDraft>) {
    setRequests((prev) =>
      prev.map((req) => (req.id === id ? { ...req, ...patch } : req)),
    );
  }

  async function handleSave() {
    try {
      setIsSaving(true);
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(t("settings.cronTaskName") + " is required");
      if (!cron.trim()) throw new Error(t("settings.cronExpression") + " is required");
      const trimmedRemainingExecutions = remainingExecutions.trim();
      const parsedRemainingExecutions = trimmedRemainingExecutions
        ? Number(trimmedRemainingExecutions)
        : undefined;
      if (
        parsedRemainingExecutions !== undefined &&
        (!Number.isSafeInteger(parsedRemainingExecutions) || parsedRemainingExecutions < 0)
      ) {
        throw new Error(t("settings.cronRemainingExecutionsInvalid"));
      }

      await invoke("cron_validate_expression", {
        expression: cron.trim(),
      } as any);

      const trimmedPrompt = prompt.trim();
      const trimmedScript = scriptText.trim();
      const parsedSelectedModel =
        type === "prompt" ? parseModelValue(selectedModelValue) : null;
      if (type === "bash" && !trimmedScript) {
        throw new Error(t("settings.cronCommandRequired"));
      }
      if (type === "prompt") {
        if (!autoPromptSupported) {
          throw new Error(t("settings.cronPromptAgentModeRequired"));
        }
        if (!trimmedPrompt) {
          throw new Error(t("settings.cronPromptRequired"));
        }
        if (!parsedSelectedModel) {
          throw new Error(
            promptModelOptions.length === 0
              ? t("settings.cronPromptModelEmpty")
              : t("settings.cronPromptModelRequired"),
          );
        }
      }

      const data: Omit<CronTask, "id"> = {
        name: trimmedName,
        description: description.trim(),
        cron: cron.trim(),
        enabled: parsedRemainingExecutions === 0 ? false : (initialData?.enabled ?? true),
        remainingExecutions: parsedRemainingExecutions,
        type,
        script: type === "bash" ? trimmedScript : undefined,
        requests:
          type === "http"
            ? parseHttpRequests(requests, {
                required: t("settings.cronHttpRequestRequired"),
                urlRequired: (index) => `${t("settings.cronHttpUrlRequired")} #${index + 1}`,
                urlInvalid: (index) => `${t("settings.cronHttpUrlInvalid")} #${index + 1}`,
                headersInvalid: t("settings.cronHttpHeadersInvalid"),
                bodyInvalid: t("settings.cronHttpBodyInvalid"),
              })
            : undefined,
        prompt: type === "prompt" ? trimmedPrompt : undefined,
        selectedModel: type === "prompt" ? parsedSelectedModel ?? undefined : undefined,
      };

      await onSave(data);
      requestClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  const scriptLineCount = scriptText.split(/\r?\n/).filter((l) => l.trim()).length;

  const modalTitle = mode === "add"
    ? t("settings.cronModalAdd")
    : t("settings.cronModalEdit");

  return createPortal(
    <div
      className="settings-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      data-state={modalState}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={requestClose} />

      <div className="settings-modal-panel relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl">
        {/* Header */}
        <div className="settings-modal-header flex items-center gap-3 border-b border-border/40 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Clock3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{modalTitle}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.cronExpressionHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            title={t("settings.cancel")}
            aria-label={t("settings.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="settings-modal-body flex-1 overflow-y-auto">
          {/* Step 1: Basic Info */}
          <div className="border-b border-border/30 px-6 py-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                1
              </div>
              <span className="text-sm font-semibold">{t("settings.cronStepBasic")}</span>
            </div>

            <div className="space-y-4">
              <div className="settings-form-grid grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("settings.cronTaskName")}
                  </Label>
                  <Input
                    value={name}
                    placeholder={t("settings.cronTaskNamePlaceholder")}
                    onChange={(e) => {
                      setFormError(null);
                      setName(e.currentTarget.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("settings.cronExpression")}
                  </Label>
                  <Input
                    value={cron}
                    placeholder={t("settings.cronExpressionPlaceholder")}
                    className="font-mono"
                    onChange={(e) => {
                      setFormError(null);
                      setCron(e.currentTarget.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("settings.cronRemainingExecutions")}
                  </Label>
                  <Input
                    value={remainingExecutions}
                    inputMode="numeric"
                    placeholder={t("settings.cronRemainingExecutionsPlaceholder")}
                    onChange={(e) => {
                      const next = e.currentTarget.value.trim();
                      if (next && !/^\d+$/.test(next)) return;
                      setFormError(null);
                      setRemainingExecutions(next);
                    }}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {t("settings.cronTaskDesc")}
                </Label>
                <Input
                  value={description}
                  placeholder={t("settings.cronTaskDescPlaceholder")}
                  onChange={(e) => {
                    setFormError(null);
                    setDescription(e.currentTarget.value);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Step 2: Task Type */}
          <div className="border-b border-border/30 px-6 py-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                2
              </div>
              <span className="text-sm font-semibold">{t("settings.cronStepType")}</span>
            </div>

            <div className="settings-choice-grid settings-cron-type-grid grid grid-cols-3 gap-3">
              {/* Bash */}
              <button
                type="button"
                onClick={() => { setFormError(null); setType("bash"); }}
                className={`group relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                  type === "bash"
                    ? "border-blue-500/50 bg-blue-500/5 shadow-sm shadow-blue-500/10"
                    : "border-border/60 bg-background hover:border-border hover:bg-muted/20"
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  type === "bash" ? "bg-blue-500/15 text-blue-500" : "bg-muted/60 text-muted-foreground"
                }`}>
                  <Terminal className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold ${type === "bash" ? "text-blue-600 dark:text-blue-400" : "text-foreground"}`}>
                    {t("settings.cronTypeBash")}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("settings.cronTypeBashHint")}
                  </p>
                </div>
                {type === "bash" ? (
                  <div className="absolute right-3 top-3">
                    <CheckCircle2 className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                ) : null}
              </button>

              {/* HTTP */}
              <button
                type="button"
                onClick={() => { setFormError(null); setType("http"); }}
                className={`group relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                  type === "http"
                    ? "border-emerald-500/50 bg-emerald-500/5 shadow-sm shadow-emerald-500/10"
                    : "border-border/60 bg-background hover:border-border hover:bg-muted/20"
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  type === "http" ? "bg-emerald-500/15 text-emerald-500" : "bg-muted/60 text-muted-foreground"
                }`}>
                  <Globe className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold ${type === "http" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                    {t("settings.cronTypeHttp")}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("settings.cronTypeHttpHint")}
                  </p>
                </div>
                {type === "http" ? (
                  <div className="absolute right-3 top-3">
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" />
                  </div>
                ) : null}
              </button>

              {/* Prompt */}
              <button
                type="button"
                onClick={() => { setFormError(null); setType("prompt"); }}
                className={`group relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                  type === "prompt"
                    ? "border-violet-500/50 bg-violet-500/5 shadow-sm shadow-violet-500/10"
                    : "border-border/60 bg-background hover:border-border hover:bg-muted/20"
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  type === "prompt" ? "bg-violet-500/15 text-violet-500" : "bg-muted/60 text-muted-foreground"
                }`}>
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-semibold ${type === "prompt" ? "text-violet-600 dark:text-violet-400" : "text-foreground"}`}>
                    {t("settings.cronTypePrompt")}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("settings.cronTypePromptHint")}
                  </p>
                </div>
                {type === "prompt" ? (
                  <div className="absolute right-3 top-3">
                    <CheckCircle2 className="h-4.5 w-4.5 text-violet-500" />
                  </div>
                ) : null}
              </button>
            </div>
          </div>

          {/* Step 3: Configuration */}
          <div className="px-6 py-5">
            <div className="settings-modal-step-row mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                  3
                </div>
                <span className="text-sm font-semibold">{t("settings.cronStepConfig")}</span>
              </div>

              {type === "bash" ? (
                <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                  {scriptLineCount} {t("settings.cronCommandsCount")}
                </span>
              ) : type === "http" ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {requests.length} {t("settings.cronRequestsCount")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-xs"
                    onClick={() => {
                      setFormError(null);
                      const draft = createEmptyRequestDraft();
                      setRequests((prev) => [...prev, draft]);
                      setExpandedRequest(draft.id);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    {t("settings.add")}
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Shell script config */}
            {type === "bash" ? (
              <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
                <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    <span className="font-medium">{t("settings.cronCommandList")}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground/60">
                    {t("settings.cronCommandHint")}
                  </span>
                </div>
                <Textarea
                  value={scriptText}
                  placeholder={"pnpm install\npnpm build\npnpm test"}
                  className="min-h-[180px] resize-y rounded-none border-0 bg-transparent font-mono text-sm leading-relaxed focus-visible:ring-0"
                  onChange={(e) => {
                    setFormError(null);
                    setScriptText(e.currentTarget.value);
                  }}
                />
              </div>
            ) : null}

            {/* HTTP request config */}
            {type === "http" ? (
              <div className="space-y-3">
                {requests.map((request, index) => {
                  const bodyEnabled = canHookHttpMethodHaveBody(request.method);
                  const isExpanded = expandedRequest === request.id;

                  return (
                    <div
                      key={request.id}
                      className="overflow-hidden rounded-xl border border-border/60 bg-background/80 transition-colors hover:border-border/80"
                    >
                      <div className="settings-http-row flex items-center gap-3 px-4 py-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          {index + 1}
                        </div>

                        <Select
                          value={request.method}
                          onValueChange={(value) => {
                            setFormError(null);
                            updateRequest(request.id, {
                              method: value as HookHttpMethod,
                              bodyText: canHookHttpMethodHaveBody(value as HookHttpMethod)
                                ? request.bodyText
                                : "",
                            });
                          }}
                        >
                          <SelectTrigger className="h-8 w-[100px] text-xs font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {HOOK_HTTP_METHODS.map((method) => (
                              <SelectItem key={method} value={method}>
                                {method}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          value={request.url}
                          placeholder="https://example.com/webhook"
                          className="h-8 flex-1 font-mono text-xs"
                          onChange={(e) => {
                            setFormError(null);
                            updateRequest(request.id, { url: e.currentTarget.value });
                          }}
                        />

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setExpandedRequest(isExpanded ? null : request.id)}
                            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted/50 ${
                              isExpanded ? "text-primary" : "text-muted-foreground"
                            }`}
                          >
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFormError(null);
                              setRequests((prev) => prev.filter((r) => r.id !== request.id));
                              if (expandedRequest === request.id) setExpandedRequest(null);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-border/30 bg-muted/10 px-4 py-4">
                          <div className="settings-form-grid grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-muted-foreground">
                                Headers
                              </Label>
                              <Textarea
                                value={request.headersText}
                                placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                                className="min-h-[100px] resize-y font-mono text-xs leading-relaxed"
                                onChange={(e) => {
                                  setFormError(null);
                                  updateRequest(request.id, { headersText: e.currentTarget.value });
                                }}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-muted-foreground">
                                Body
                              </Label>
                              {bodyEnabled ? (
                                <Textarea
                                  value={request.bodyText}
                                  placeholder={'{\n  "message": "hello"\n}'}
                                  className="min-h-[100px] resize-y font-mono text-xs leading-relaxed"
                                  onChange={(e) => {
                                    setFormError(null);
                                    updateRequest(request.id, { bodyText: e.currentTarget.value });
                                  }}
                                />
                              ) : (
                                <div className="flex min-h-[100px] items-center justify-center rounded-lg border border-dashed border-border/50 bg-muted/10 text-xs text-muted-foreground/60">
                                  {t("settings.cronHttpBodyDisabled")}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {requests.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/50 bg-muted/5 py-8 text-center">
                    <Globe className="mx-auto h-6 w-6 text-muted-foreground/30" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("settings.cronHttpRequests")}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Prompt config */}
            {type === "prompt" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.cronPromptRunHint")}
                </div>

                {!autoPromptSupported ? (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3.5 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                    {t("settings.cronPromptAgentModeOnlyHint")}
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("settings.cronPromptModelLabel")}
                  </Label>
                  <Select
                    value={selectedModelValue}
                    onValueChange={(value) => {
                      setFormError(null);
                      setSelectedModelValue(value);
                    }}
                  >
                    <SelectTrigger disabled={promptModelOptions.length === 0}>
                      <SelectValue placeholder={t("settings.cronPromptModelPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {promptModelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.providerName} / {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPromptModel ? (
                    <div className="text-[11px] text-muted-foreground/80">
                      {selectedPromptModel.providerName} / {selectedPromptModel.label}
                    </div>
                  ) : null}
                  {promptModelOptions.length === 0 ? (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      {t("settings.cronPromptModelEmpty")}
                    </div>
                  ) : null}
                </div>

                <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
                  <div className="flex items-center gap-1.5 border-b border-border/30 px-3 py-2 text-[11px] text-muted-foreground">
                    <MessageSquare className="h-3 w-3" />
                    <span className="font-medium">{t("settings.cronPromptLabel")}</span>
                  </div>
                  <Textarea
                    value={prompt}
                    placeholder={t("settings.cronPromptPlaceholder")}
                    className="min-h-[180px] resize-y rounded-none border-0 bg-transparent text-sm leading-relaxed focus-visible:ring-0"
                    onChange={(e) => {
                      setFormError(null);
                      setPrompt(e.currentTarget.value);
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-modal-footer flex items-center justify-between border-t border-border/40 px-6 py-4">
          <div className="min-w-0 flex-1">
            {formError ? (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{formError}</span>
              </div>
            ) : name.trim() &&
              cron.trim() &&
              (type !== "prompt" || (prompt.trim() && Boolean(parseModelValue(selectedModelValue)))) ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                <span>{t("settings.agentsReady")}</span>
              </div>
            ) : null}
          </div>
          <div className="settings-modal-actions flex items-center gap-2">
            <Button variant="outline" onClick={requestClose}>
              {t("settings.cancel")}
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={!name.trim() || !cron.trim() || isSaving || isClosing}
            >
              {t("settings.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
