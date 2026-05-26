import { type ReactNode, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Globe,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
  Zap,
} from "../../components/icons";

import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import {
  type ConversationHook,
  HOOK_LIFECYCLE_EVENTS,
  type HookLifecycleEventType,
  updateHooks,
} from "../../lib/settings";
import { HookModal } from "./HookModal";
import { getHookEventDescription, getHookEventLabel, getHookTypeTone } from "./hookUtils";
import { AgentActivationSwitch, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

type LifecyclePhase = {
  key: string;
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  dotColor: string;
  icon: ReactNode;
  events: HookLifecycleEventType[];
};

type PhaseGroup = {
  phase: LifecyclePhase;
  items: { event: HookLifecycleEventType; index: number }[];
};

export function HooksSection(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const [activeEvent, setActiveEvent] = useState<HookLifecycleEventType>(HOOK_LIFECYCLE_EVENTS[0]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHook, setEditingHook] = useState<ConversationHook | null>(null);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());

  const hooks = settings.hooks;
  const activeHooks = hooks.filter((hook) => hook.event === activeEvent);
  const enabledCount = hooks.filter((hook) => hook.enabled).length;
  const disabledCount = hooks.length - enabledCount;

  const phases: LifecyclePhase[] = [
    {
      key: "agent",
      label: t("settings.hooksPhaseAgent"),
      description: t("settings.hooksPhaseAgentDesc"),
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
      borderColor: "border-violet-500/20",
      dotColor: "bg-violet-500",
      icon: <Bot className="h-3.5 w-3.5" />,
      events: ["agent_start", "agent_end"],
    },
    {
      key: "turn",
      label: t("settings.hooksPhaseTurn"),
      description: t("settings.hooksPhaseTurnDesc"),
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      dotColor: "bg-blue-500",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      events: ["turn_start", "turn_end"],
    },
    {
      key: "message",
      label: t("settings.hooksPhaseMessage"),
      description: t("settings.hooksPhaseMessageDesc"),
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      dotColor: "bg-emerald-500",
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      events: ["message_start", "message_update", "message_end"],
    },
    {
      key: "tool",
      label: t("settings.hooksPhaseTool"),
      description: t("settings.hooksPhaseToolDesc"),
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      dotColor: "bg-amber-500",
      icon: <Wrench className="h-3.5 w-3.5" />,
      events: ["tool_execution_start", "tool_execution_update", "tool_execution_end"],
    },
  ];

  const orderedEvents: { event: HookLifecycleEventType; phase: LifecyclePhase }[] = [
    { event: "agent_start", phase: phases[0] },
    { event: "turn_start", phase: phases[1] },
    { event: "message_start", phase: phases[2] },
    { event: "message_update", phase: phases[2] },
    { event: "message_end", phase: phases[2] },
    { event: "tool_execution_start", phase: phases[3] },
    { event: "tool_execution_update", phase: phases[3] },
    { event: "tool_execution_end", phase: phases[3] },
    { event: "turn_end", phase: phases[1] },
    { event: "agent_end", phase: phases[0] },
  ];

  function togglePhase(key: string) {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closeModal() {
    setModalOpen(false);
    setEditingHook(null);
  }

  function openAdd() {
    setEditingHook(null);
    setModalOpen(true);
  }

  function openEdit(hook: ConversationHook) {
    setEditingHook(hook);
    setActiveEvent(hook.event);
    setModalOpen(true);
  }

  function handleSave(data: Omit<ConversationHook, "id">) {
    setSettings((prev) => {
      const nextHook: ConversationHook = editingHook
        ? { ...editingHook, ...data }
        : { id: crypto.randomUUID(), ...data };

      return updateHooks(
        prev,
        editingHook
          ? prev.hooks.map((hook) => (hook.id === editingHook.id ? nextHook : hook))
          : [...prev.hooks, nextHook],
      );
    });
    closeModal();
  }

  function updateHookState(hookId: string, updater: (hook: ConversationHook) => ConversationHook) {
    setSettings((prev) =>
      updateHooks(
        prev,
        prev.hooks.map((hook) => (hook.id === hookId ? updater(hook) : hook)),
      ),
    );
  }

  function deleteHook(hookId: string) {
    setSettings((prev) =>
      updateHooks(
        prev,
        prev.hooks.filter((hook) => hook.id !== hookId),
      ),
    );
  }

  const phaseGroups: PhaseGroup[] = [];
  let currentGroup: PhaseGroup | null = null;

  for (let index = 0; index < orderedEvents.length; index += 1) {
    const { event, phase } = orderedEvents[index];
    if (!currentGroup || currentGroup.phase.key !== phase.key) {
      currentGroup = { phase, items: [] };
      phaseGroups.push(currentGroup);
    }
    currentGroup.items.push({ event, index });
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="shrink-0 flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">{t("settings.hooksTitle")}</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {t("settings.hooksDesc")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-3 py-1.5">
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {t("settings.hooksTotalHooks")}
            </span>
            <span className="ml-0.5 text-sm font-bold tabular-nums">{hooks.length}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {t("settings.hooksActiveHooks")}
            </span>
            <span className="ml-0.5 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {enabledCount}
            </span>
          </div>
          {disabledCount > 0 ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5">
              <Circle className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.hooksInactiveHooks")}
              </span>
              <span className="ml-0.5 text-sm font-bold tabular-nums text-muted-foreground">
                {disabledCount}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="shrink-0 border-b border-border/40 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Play className="h-4 w-4 text-muted-foreground" />
              {t("settings.hooksLifecycle")}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {phaseGroups.map((group, groupIndex) => {
              const phaseHookCount = group.items.reduce(
                (sum, { event }) => sum + hooks.filter((hook) => hook.event === event).length,
                0,
              );
              const groupKey = `${group.phase.key}-${groupIndex}`;
              const isCollapsed = collapsedPhases.has(groupKey);

              return (
                <div key={groupKey} className="mb-1 last:mb-0">
                  <button
                    type="button"
                    onClick={() => togglePhase(groupKey)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/40 ${group.phase.color}`}
                  >
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-lg ${group.phase.bgColor}`}
                    >
                      {group.phase.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide">
                          {group.phase.label}
                        </span>
                        {phaseHookCount > 0 ? (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${group.phase.bgColor}`}
                          >
                            {phaseHookCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                        isCollapsed ? "-rotate-90" : ""
                      }`}
                    />
                  </button>

                  {!isCollapsed ? (
                    <div className="relative ml-3 mt-0.5">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3 top-2 bottom-2 w-[2px] -translate-x-1/2 rounded-full bg-border/40"
                      />
                      <ul className="space-y-0.5">
                        {group.items.map(({ event }) => {
                          const eventHooks = hooks.filter((hook) => hook.event === event);
                          const selected = activeEvent === event;
                          const hasHooks = eventHooks.length > 0;

                          return (
                            <li key={event}>
                              <button
                                type="button"
                                onClick={() => setActiveEvent(event)}
                                className={`group relative flex w-full items-center gap-2.5 rounded-lg py-2 pl-7 pr-2.5 text-left transition-all ${
                                  selected ? "bg-primary/10 shadow-sm" : "hover:bg-muted/30"
                                }`}
                              >
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute left-3 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2"
                                >
                                  {selected ? (
                                    <span
                                      aria-hidden
                                      className={`absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full ${group.phase.dotColor} opacity-25`}
                                    />
                                  ) : null}
                                  <span
                                    className={`relative block h-full w-full rounded-full ring-2 ring-card transition-all duration-200 ${
                                      selected
                                        ? group.phase.dotColor
                                        : hasHooks
                                          ? `${group.phase.dotColor} opacity-80`
                                          : "border border-border/60 bg-card"
                                    }`}
                                  />
                                </span>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`text-[13px] font-medium transition-colors ${
                                        selected
                                          ? "text-foreground"
                                          : "text-muted-foreground group-hover:text-foreground"
                                      }`}
                                    >
                                      {getHookEventLabel(t, event)}
                                    </span>
                                    {hasHooks ? (
                                      <span
                                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                                          selected
                                            ? "bg-primary/15 text-primary"
                                            : "bg-muted/60 text-muted-foreground"
                                        }`}
                                      >
                                        {eventHooks.length}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="shrink-0 border-b border-border/40 px-5 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                {(() => {
                  const phase = orderedEvents.find((item) => item.event === activeEvent)?.phase;
                  if (!phase) return null;
                  return (
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${phase.bgColor} ${phase.color}`}
                    >
                      {phase.icon}
                    </div>
                  );
                })()}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{getHookEventLabel(t, activeEvent)}</h3>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {getHookEventDescription(t, activeEvent)}
                  </p>
                </div>
              </div>
              <Button className="gap-1.5 self-start" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" />
                {t("settings.hooksAdd")}
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeHooks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/5 px-6 py-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/30">
                  <Zap className="h-6 w-6 text-muted-foreground/40" />
                </div>
                <div className="mt-4 text-sm font-medium">{t("settings.hooksEmptyTitle")}</div>
                <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {t("settings.hooksEmptyDesc")}
                </p>
                <Button className="mt-5 gap-1.5" size="sm" onClick={openAdd}>
                  <Plus className="h-3.5 w-3.5" />
                  {t("settings.hooksAdd")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {activeHooks.map((hook) => {
                  const stepCount =
                    hook.type === "command"
                      ? (hook.script ?? "").split(/\r?\n/).filter((line) => line.trim()).length
                      : (hook.requests?.length ?? 0);
                  return (
                    <div
                      key={hook.id}
                      className={`group rounded-xl border bg-background/80 p-4 transition-all hover:shadow-sm ${
                        hook.enabled
                          ? "border-border/60 hover:border-border"
                          : "border-border/40 opacity-60"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${getHookTypeTone(hook.type)}`}
                        >
                          {hook.type === "command" ? (
                            <Terminal className="h-4.5 w-4.5" />
                          ) : (
                            <Globe className="h-4.5 w-4.5" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold">{hook.name}</span>
                            <span className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                              {stepCount}{" "}
                              {hook.type === "command"
                                ? t("settings.hooksScriptLinesCount")
                                : t("settings.hooksRequestsCount")}
                            </span>
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {hook.description || t("settings.hooksNoDescription")}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <AgentActivationSwitch
                            checked={hook.enabled}
                            title={hook.enabled ? t("settings.disable") : t("settings.enable")}
                            onToggle={() =>
                              updateHookState(hook.id, (current) => ({
                                ...current,
                                enabled: !current.enabled,
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title={t("settings.edit")}
                            onClick={() => openEdit(hook)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <ConfirmDeletePopover
                            name={hook.name}
                            onConfirm={() => deleteHook(hook.id)}
                          >
                            {(open) => (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                title={t("settings.delete")}
                                onClick={open}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </ConfirmDeletePopover>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {modalOpen ? (
        <HookModal
          event={editingHook?.event ?? activeEvent}
          initialData={editingHook ?? undefined}
          onSave={handleSave}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}
