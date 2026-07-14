import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RefreshCw, X } from "../../components/icons";
import { Button } from "../../components/ui/button";
import type { CodexRequestFormat, ProviderId } from "../../lib/settings";

export type CherryProviderImportItem = {
  sourceId: string;
  sourceVersion: string;
  sourceProviderType: string;
  providerType: ProviderId;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeyCount: number;
  requestFormat: CodexRequestFormat;
  enabled: boolean;
  importable: boolean;
  reason: string;
  warning: string;
  excludedModelCount: number;
};

export type CherryProvidersResponse = {
  status: string;
  message: string;
  version: string;
  dataPath: string;
  totalProviderCount: number;
  enabledProviderCount: number;
  providers: CherryProviderImportItem[];
};

type CherryStudioImportModalProps = {
  providerType: ProviderId;
  response: CherryProvidersResponse;
  importing: boolean;
  isExisting: (item: CherryProviderImportItem) => boolean;
  onClose: () => void;
  onConfirm: (items: CherryProviderImportItem[]) => void;
};

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude_code: "Anthropic",
  codex: "OpenAI",
  gemini: "Gemini",
};

function itemKey(item: CherryProviderImportItem) {
  return `${item.sourceId}\n${item.baseUrl}\n${item.requestFormat}`;
}

function itemProtocolLabel(item: CherryProviderImportItem) {
  if (item.providerType === "claude_code") return "Anthropic Messages";
  if (item.providerType === "gemini") return "Gemini Generate Content";
  return item.requestFormat === "openai-responses" ? "Responses API" : "Chat Completions";
}

export function CherryStudioImportModal(props: CherryStudioImportModalProps) {
  const { providerType, response, importing, isExisting, onClose, onConfirm } = props;
  const candidates = useMemo(
    () => response.providers.filter((item) => item.providerType === providerType),
    [providerType, response.providers],
  );
  const defaultSelected = useMemo(
    () => candidates.filter((item) => item.enabled && item.importable).map(itemKey),
    [candidates],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelected));
  const [showAll, setShowAll] = useState(defaultSelected.length === 0);

  const visibleItems = showAll
    ? candidates
    : candidates.filter((item) => item.enabled && item.importable);
  const selectedItems = candidates.filter((item) => selected.has(itemKey(item)) && item.importable);

  function toggleItem(item: CherryProviderImportItem) {
    if (!item.importable || importing) return;
    setSelected((current) => {
      const next = new Set(current);
      const key = itemKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of visibleItems) {
        if (item.importable) next.add(itemKey(item));
      }
      return next;
    });
  }

  function clearVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of visibleItems) next.delete(itemKey(item));
      return next;
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭 Cherry Studio 同步"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={importing ? undefined : onClose}
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <div className="text-base font-semibold">从 Cherry Studio 同步</div>
            <div className="mt-1 text-xs text-muted-foreground">
              仅同步 Base URL 和 API Key，模型由 LiveAgent 获取并激活；当前显示{" "}
              {PROVIDER_LABELS[providerType]} 配置
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            disabled={importing}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-6 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => setShowAll(event.currentTarget.checked)}
              disabled={importing}
            />
            显示禁用或不兼容配置
          </label>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={selectVisible}>
              全选可用项
            </button>
            <span className="text-muted-foreground">/</span>
            <button type="button" className="text-primary hover:underline" onClick={clearVisible}>
              清空
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {visibleItems.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              当前标签下没有可同步的 Cherry Studio 聊天供应商
            </div>
          ) : (
            <div className="space-y-2">
              {visibleItems.map((item) => {
                const checked = selected.has(itemKey(item));
                const existing = isExisting(item);
                return (
                  <button
                    key={itemKey(item)}
                    type="button"
                    className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      item.importable
                        ? checked
                          ? "border-primary/45 bg-primary/[0.06]"
                          : "hover:bg-accent/40"
                        : "cursor-not-allowed bg-muted/25 opacity-65"
                    }`}
                    onClick={() => toggleItem(item)}
                    disabled={!item.importable || importing}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked && item.importable
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {checked && item.importable ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-medium">{item.name}</strong>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {itemProtocolLabel(item)}
                        </span>
                        {existing ? (
                          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-300">
                            将更新
                          </span>
                        ) : null}
                        {!item.enabled ? (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                            Cherry 中已禁用
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {item.baseUrl || "未配置 Base URL"}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.apiKeyCount > 0 ? "密钥已配置" : "无可迁移密钥"} · 模型由 LiveAgent 从
                        API 获取
                        {item.excludedModelCount > 0
                          ? ` · Cherry 中识别到 ${item.excludedModelCount} 个非聊天模型`
                          : ""}
                      </span>
                      {item.reason ? (
                        <span className="mt-1.5 block text-xs text-destructive">{item.reason}</span>
                      ) : item.warning ? (
                        <span className="mt-1.5 block text-xs text-amber-700 dark:text-amber-300">
                          {item.warning}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-3 border-t bg-background px-6 py-4">
          <div className="rounded-lg border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
            同步后 LiveAgent 会使用自己的模型获取功能请求供应商
            API，并自动激活获取到的全部聊天模型。
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              已选择 {selectedItems.length} 个供应商配置
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose} disabled={importing}>
                取消
              </Button>
              <Button
                className="min-w-32 gap-2"
                onClick={() => onConfirm(selectedItems)}
                disabled={importing || selectedItems.length === 0}
              >
                {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                {importing ? "正在同步…" : `同步 ${selectedItems.length} 个`}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
