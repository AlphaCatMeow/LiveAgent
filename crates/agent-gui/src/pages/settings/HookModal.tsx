import { useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Globe,
  Plus,
  Terminal,
  Trash2,
  X,
  Zap,
} from "../../components/icons";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useLocale } from "../../i18n";
import {
  type ConversationHook,
  type ConversationHookType,
  canHookHttpMethodHaveBody,
  HOOK_HTTP_METHODS,
  type HookHttpMethod,
  type HookLifecycleEventType,
} from "../../lib/settings";
import {
  createEmptyHookRequestDraft,
  getHookEventLabel,
  type HookHttpRequestDraft,
  hookRequestToDraft,
} from "./hookUtils";
import { parseHttpRequests } from "./taskConfigUtils";

type HookModalProps = {
  event: HookLifecycleEventType;
  initialData?: ConversationHook;
  onSave: (data: Omit<ConversationHook, "id">) => void;
  onClose: () => void;
};

export function HookModal({ event, initialData, onSave, onClose }: HookModalProps) {
  const { t } = useLocale();
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [type, setType] = useState<ConversationHookType>(initialData?.type ?? "command");
  const [scriptText, setScriptText] = useState(initialData?.script ?? "");
  const [requests, setRequests] = useState<HookHttpRequestDraft[]>(() => {
    if (initialData?.requests?.length) {
      return initialData.requests.map((request) => hookRequestToDraft(request));
    }
    return [createEmptyHookRequestDraft()];
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);

  const isEditing = Boolean(initialData);

  function handleSave() {
    try {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error(t("settings.hooksNameRequired"));
      }
      const trimmedScript = scriptText.trim();
      if (type === "command" && !trimmedScript) {
        throw new Error(t("settings.hooksCommandRequired"));
      }

      onSave({
        event,
        name: trimmedName,
        description: description.trim(),
        enabled: initialData?.enabled ?? true,
        type,
        script: type === "command" ? trimmedScript : undefined,
        requests:
          type === "http"
            ? parseHttpRequests(requests, {
                required: t("settings.hooksHttpRequestRequired"),
                urlRequired: (index) => `${t("settings.hooksHttpUrlRequired")} #${index + 1}`,
                urlInvalid: (index) => `${t("settings.hooksHttpUrlInvalid")} #${index + 1}`,
                headersInvalid: t("settings.hooksHttpHeadersInvalid"),
                bodyInvalid: t("settings.hooksHttpBodyInvalid"),
              })
            : undefined,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  function updateRequest(id: string, patch: Partial<HookHttpRequestDraft>) {
    setRequests((prev) =>
      prev.map((request) => (request.id === id ? { ...request, ...patch } : request)),
    );
  }

  const scriptLineCount = scriptText.split(/\r?\n/).filter((line) => line.trim()).length;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Zap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">
              {isEditing ? t("settings.hooksEdit") : t("settings.hooksAdd")}
            </h2>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {event}
              </span>
              <span className="text-xs text-muted-foreground">{getHookEventLabel(t, event)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t("settings.cancel")}
            aria-label={t("settings.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-border/30 px-6 py-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                1
              </div>
              <span className="text-sm font-semibold">{t("settings.hooksName")}</span>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="hook-name" className="text-xs font-medium text-muted-foreground">
                    {t("settings.hooksName")}
                  </Label>
                  <Input
                    id="hook-name"
                    value={name}
                    placeholder={t("settings.hooksNamePlaceholder")}
                    onChange={(e) => {
                      setFormError(null);
                      setName(e.currentTarget.value);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="hook-description"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t("settings.hooksDescription")}
                  </Label>
                  <Input
                    id="hook-description"
                    value={description}
                    placeholder={t("settings.hooksDescriptionPlaceholder")}
                    onChange={(e) => {
                      setFormError(null);
                      setDescription(e.currentTarget.value);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-border/30 px-6 py-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                2
              </div>
              <span className="text-sm font-semibold">{t("settings.hooksType")}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setType("command");
                }}
                className={`group relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                  type === "command"
                    ? "border-blue-500/50 bg-blue-500/5 shadow-sm shadow-blue-500/10"
                    : "border-border/60 bg-background hover:border-border hover:bg-muted/20"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    type === "command"
                      ? "bg-blue-500/15 text-blue-500"
                      : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  <Terminal className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-semibold ${
                      type === "command" ? "text-blue-600 dark:text-blue-400" : "text-foreground"
                    }`}
                  >
                    {t("settings.hooksTypeCommand")}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("settings.hooksCommandHint")}
                  </p>
                </div>
                {type === "command" ? (
                  <div className="absolute right-3 top-3">
                    <CheckCircle2 className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setType("http");
                }}
                className={`group relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                  type === "http"
                    ? "border-emerald-500/50 bg-emerald-500/5 shadow-sm shadow-emerald-500/10"
                    : "border-border/60 bg-background hover:border-border hover:bg-muted/20"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    type === "http"
                      ? "bg-emerald-500/15 text-emerald-500"
                      : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  <Globe className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-semibold ${
                      type === "http" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
                    }`}
                  >
                    {t("settings.hooksTypeHttp")}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("settings.hooksHttpHint")}
                  </p>
                </div>
                {type === "http" ? (
                  <div className="absolute right-3 top-3">
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500" />
                  </div>
                ) : null}
              </button>
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">
                  3
                </div>
                <span className="text-sm font-semibold">
                  {type === "command"
                    ? t("settings.hooksCommandList")
                    : t("settings.hooksHttpRequests")}
                </span>
              </div>
              {type === "command" ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    {scriptLineCount} {t("settings.hooksScriptLinesCount")}
                  </span>
                  <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {t("settings.hooksSequential")}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {requests.length} {t("settings.hooksRequestsCount")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-xs"
                    onClick={() => {
                      setFormError(null);
                      const draft = createEmptyHookRequestDraft();
                      setRequests((prev) => [...prev, draft]);
                      setExpandedRequest(draft.id);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    {t("settings.add")}
                  </Button>
                </div>
              )}
            </div>

            {type === "command" ? (
              <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
                <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Terminal className="h-3 w-3" />
                    <span className="font-medium">{t("settings.hooksCommandList")}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground/60">
                    {t("settings.hooksCommandHint")}
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
            ) : (
              <div className="space-y-3">
                {requests.map((request, index) => {
                  const bodyEnabled = canHookHttpMethodHaveBody(request.method);
                  const isExpanded = expandedRequest === request.id;

                  return (
                    <div
                      key={request.id}
                      className="overflow-hidden rounded-xl border border-border/60 bg-background/80 transition-colors hover:border-border/80"
                    >
                      <div className="flex items-center gap-3 px-4 py-3">
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
                            <SelectValue placeholder={t("settings.hooksHttpMethod")} />
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
                          placeholder="https://example.com/hook"
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
                            title={isExpanded ? "Collapse" : "Expand"}
                          >
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform ${
                                isExpanded ? "" : "-rotate-90"
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFormError(null);
                              setRequests((prev) => prev.filter((item) => item.id !== request.id));
                              if (expandedRequest === request.id) {
                                setExpandedRequest(null);
                              }
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            title={t("settings.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-border/30 bg-muted/10 px-4 py-4">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-muted-foreground">
                                {t("settings.hooksHttpHeaders")}
                              </Label>
                              <Textarea
                                value={request.headersText}
                                placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                                className="min-h-[100px] resize-y font-mono text-xs leading-relaxed"
                                onChange={(e) => {
                                  setFormError(null);
                                  updateRequest(request.id, {
                                    headersText: e.currentTarget.value,
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-muted-foreground">
                                {t("settings.hooksHttpBody")}
                              </Label>
                              {bodyEnabled ? (
                                <Textarea
                                  value={request.bodyText}
                                  placeholder={'{\n  "message": "hello"\n}'}
                                  className="min-h-[100px] resize-y font-mono text-xs leading-relaxed"
                                  onChange={(e) => {
                                    setFormError(null);
                                    updateRequest(request.id, {
                                      bodyText: e.currentTarget.value,
                                    });
                                  }}
                                />
                              ) : (
                                <div className="flex min-h-[100px] items-center justify-center rounded-lg border border-dashed border-border/50 bg-muted/10 text-xs text-muted-foreground/60">
                                  {t("settings.hooksHttpBodyDisabled")}
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
                      {t("settings.hooksHttpRequestRequired")}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/40 px-6 py-4">
          <div className="min-w-0 flex-1">
            {formError ? (
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{formError}</span>
              </div>
            ) : name.trim() ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                <span>{t("settings.agentsReady")}</span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("settings.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!name.trim()}>
              {t("settings.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
