import { useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Cpu,
  FolderOpen,
  MessageSquare,
  Moon,
  Sun,
  Terminal,
  Wrench,
} from "../../components/icons";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { SUPPORTED_LOCALES, useLocale } from "../../i18n";
import {
  type ExecutionMode,
  type Theme,
  isAgentExecutionMode,
  updateSystem,
} from "../../lib/settings";
import { CUSTOM_SYSTEM_TOOL_OPTIONS } from "../../lib/tools/customSystemTools";
import type { SettingsSectionProps } from "./types";
import { WorkdirPickerModal } from "./WorkdirPickerModal";

export function SystemSettingsForm(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const [workdirPickerOpen, setWorkdirPickerOpen] = useState(false);

  const workdirId = "system-workdir";
  const executionMode = settings.system.executionMode;
  const workdir = settings.system.workdir;
  const selectedSystemTools = settings.system.selectedSystemTools;
  const isAgentMode = isAgentExecutionMode(executionMode);
  const isClassicAgentMode = executionMode === "tools";
  const isAgentDevMode = executionMode === "agent-dev";

  return (
    <div className="settings-system-section space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          {t("settings.executionMode")}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.executionModeDesc")}
        </p>

        <div className="settings-choice-grid grid grid-cols-1 gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={() =>
              setSettings((prev) =>
                updateSystem(prev, { executionMode: "text" as ExecutionMode }),
              )
            }
            className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              executionMode === "text"
                ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
            }`}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                executionMode === "text"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground group-hover:bg-accent"
              }`}
            >
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t("settings.chatMode")}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.chatModeDesc")}
              </div>
            </div>
            {executionMode === "text" ? (
              <div className="absolute right-3 top-3">
                <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              </div>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() =>
              setSettings((prev) =>
                updateSystem(prev, { executionMode: "tools" as ExecutionMode }),
              )
            }
            className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              isClassicAgentMode
                ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
            }`}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                isClassicAgentMode
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground group-hover:bg-accent"
              }`}
            >
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t("settings.agentMode")}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.agentModeDesc")}
              </div>
            </div>
            {isClassicAgentMode ? (
              <div className="absolute right-3 top-3">
                <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              </div>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() =>
              setSettings((prev) =>
                updateSystem(prev, { executionMode: "agent-dev" as ExecutionMode }),
              )
            }
            className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              isAgentDevMode
                ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
            }`}
          >
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                isAgentDevMode
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground group-hover:bg-accent"
              }`}
            >
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t("settings.agentDevMode")}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.agentDevModeDesc")}
              </div>
            </div>
            {isAgentDevMode ? (
              <div className="absolute right-3 top-3">
                <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              </div>
            ) : null}
          </button>
        </div>
      </div>

      <div className="border-t" />

      <div className="settings-preferences-grid grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {settings.theme === "dark" ? (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                )}
                {t("settings.appearance")}
              </div>
            </div>
          </div>

          <div className="settings-choice-grid settings-appearance-grid grid gap-2 sm:grid-cols-2">
            {(["light", "dark"] as Theme[]).map((theme) => {
              const selected = settings.theme === theme;
              return (
                <button
                  key={theme}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, theme }))}
                  className={`group relative flex h-full items-start gap-3 rounded-xl border px-3.5 py-3.5 text-left transition-all ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                      : "border-border/60 bg-background/80 hover:border-border hover:bg-muted/35"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      selected
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground group-hover:bg-accent/80"
                    }`}
                  >
                    {theme === "light" ? (
                      <Sun className="h-4.5 w-4.5" />
                    ) : (
                      <Moon className="h-4.5 w-4.5" />
                    )}
                  </div>
                  <div className="min-w-0 pr-6">
                    <div className="text-sm font-semibold">
                      {theme === "light" ? t("settings.light") : t("settings.dark")}
                    </div>
                  </div>
                  {selected ? (
                    <div className="absolute right-3 top-3">
                      <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                {t("settings.language")}
              </div>
            </div>
          </div>

          <div className="settings-choice-grid settings-language-grid grid grid-cols-2 gap-2">
            {SUPPORTED_LOCALES.map((locale) => {
              const selected = settings.locale === locale;
              const localeLabel =
                locale === "zh-CN"
                  ? t("settings.chinese")
                  : locale === "en-US"
                    ? t("settings.english")
                    : locale;
              return (
                <button
                  key={locale}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, locale }))}
                  className={`group relative flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm shadow-primary/10"
                      : "border-border/60 bg-background/80 hover:border-border hover:bg-muted/35"
                  }`}
                >
                  <span className="text-base leading-none">
                    {locale === "zh-CN" ? "🇨🇳" : "🇺🇸"}
                  </span>
                  <div className="min-w-0 flex-1 pr-5">
                    <div className="truncate text-sm font-semibold">{localeLabel}</div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {locale}
                    </div>
                  </div>
                  {selected ? (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="border-t" />

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          {t("settings.workdir")}
          {isAgentMode ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              {t("settings.workdirRequired")}
            </span>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.workdirDesc")}
        </p>

        <div className="settings-field-row settings-workdir-row flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              id={workdirId}
              className="pr-10 font-mono text-[13px]"
              value={workdir}
              placeholder={t("settings.workdirPlaceholder")}
              onChange={(e) => {
                const nextWorkdir = e.currentTarget.value;
                setSettings((prev) => updateSystem(prev, { workdir: nextWorkdir }));
              }}
            />
            {workdir.trim() ? (
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            title={t("settings.selectWorkdir")}
            aria-label={t("settings.selectWorkdir")}
            disabled={workdirPickerOpen}
            className="shrink-0"
            onClick={() => {
              setWorkdirPickerOpen(true);
            }}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>

        {isAgentMode && !workdir.trim() ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="text-xs text-amber-700 dark:text-amber-300">
              {t("settings.workdirWarning")}
            </span>
          </div>
        ) : null}
        {workdirPickerOpen ? (
          <WorkdirPickerModal
            initialWorkdir={workdir}
            onClose={() => setWorkdirPickerOpen(false)}
            onSelect={(path) => {
              setSettings((prev) => updateSystem(prev, { workdir: path }));
            }}
          />
        ) : null}
      </div>

      <div className="border-t" />

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          {t("settings.systemTools")}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.systemToolsDesc")}
        </p>

        <div className="space-y-2">
          {CUSTOM_SYSTEM_TOOL_OPTIONS.map((tool) => {
            const checked = selectedSystemTools.includes(tool.id);
            return (
              <label
                key={tool.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3.5 transition-all ${
                  checked
                    ? "border-primary/40 bg-primary/5"
                    : "border-transparent bg-muted/40 hover:border-border hover:bg-muted/60"
                }`}
              >
                <div className="mt-0.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer rounded accent-primary"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.currentTarget.checked
                        ? [...selectedSystemTools, tool.id]
                        : selectedSystemTools.filter((id) => id !== tool.id);
                      setSettings((prev) =>
                        updateSystem(prev, { selectedSystemTools: next }),
                      );
                    }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{tool.label}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {tool.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {CUSTOM_SYSTEM_TOOL_OPTIONS.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-6 text-center">
            <Wrench className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t("settings.noSystemTools")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
