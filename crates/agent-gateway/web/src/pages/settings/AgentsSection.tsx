import { useState } from "react";
import { BookOpen, ChevronRight, Pencil, Plus, Terminal, Trash2 } from "../../components/icons";

import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import { type AgentPromptTemplate, updateAgents } from "../../lib/settings";
import { AgentPromptTemplateModal } from "./AgentPromptTemplateModal";
import {
  AgentActivationSwitch,
  ConfirmDeletePopover,
  PromptTag,
} from "./shared";
import type { SettingsSectionProps } from "./types";

export function AgentsSection(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AgentPromptTemplate | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function openAdd() {
    setEditingTemplate(null);
    setModalOpen(true);
  }

  function openEdit(template: AgentPromptTemplate) {
    setEditingTemplate(template);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingTemplate(null);
  }

  function handleSave(data: Omit<AgentPromptTemplate, "id" | "enabled">) {
    setSettings((prev) => {
      if (editingTemplate) {
        return updateAgents(
          prev,
          prev.agents.map((template) =>
            template.id === editingTemplate.id ? { ...template, ...data } : template,
          ),
        );
      }

      const newTemplate: AgentPromptTemplate = {
        id: crypto.randomUUID(),
        ...data,
        enabled: false,
      };
      return updateAgents(prev, [...prev.agents, newTemplate]);
    });
  }

  function handleDelete(id: string) {
    setSettings((prev) =>
      updateAgents(prev, prev.agents.filter((template) => template.id !== id)),
    );
  }

  function handleToggleEnabled(id: string) {
    setSettings((prev) =>
      updateAgents(
        prev,
        prev.agents.map((template) => {
          if (template.id === id) {
            return { ...template, enabled: !template.enabled };
          }
          return template.enabled ? { ...template, enabled: false } : template;
        }),
      ),
    );
  }

  const templates = settings.agents;
  const enabledCount = templates.filter((template) => template.enabled).length;

  return (
    <>
      <div className="settings-agents-section space-y-5">
        <div className="settings-section-heading-row flex items-center justify-between gap-4">
          <div className="settings-section-title-group flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10">
              <BookOpen className="h-[18px] w-[18px] text-sky-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">{t("settings.agentsTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("settings.agentsDesc")}</p>
            </div>
          </div>

          <div className="settings-section-actions flex items-center gap-2">
            {templates.length > 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                <span className="tabular-nums font-medium text-foreground">
                  {templates.length}
                </span>
                {t("settings.agentsCount")}
                {enabledCount > 0 ? (
                  <>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                        {enabledCount}
                      </span>
                      {t("settings.agentsActive")}
                    </span>
                  </>
                ) : null}
              </div>
            ) : null}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              {t("settings.agentsAdd")}
            </Button>
          </div>
        </div>

        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/60 bg-muted/20 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10">
              <BookOpen className="h-6 w-6 text-sky-400" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">
                {t("settings.agentsNoTemplates")}
              </p>
              <p className="mx-auto max-w-xs text-xs leading-relaxed text-muted-foreground">
                {t("settings.agentsNoTemplatesHint")}
              </p>
            </div>
            <Button size="sm" className="mt-1 gap-1.5" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              {t("settings.agentsAdd")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((template) => {
              const isExpanded = expandedId === template.id;
              return (
                <div
                  key={template.id}
                  className={`group rounded-xl border transition-all ${
                    template.enabled
                      ? "border-sky-500/30 bg-sky-500/[0.03] shadow-sm shadow-sky-500/5"
                      : "border-border/60 bg-card hover:border-border"
                  }`}
                >
                  <div className="settings-card-row flex items-center gap-3 px-4 py-3">
                    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
                      <BookOpen className="h-4 w-4" />
                      {template.enabled ? (
                        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {template.name}
                        </span>
                        {template.enabled ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-600 dark:text-emerald-400">
                            {t("settings.agentsActiveLabel")}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {template.tags.length > 0 ? (
                          template.tags.map((tag) => <PromptTag key={tag} label={tag} />)
                        ) : (
                          <span className="text-[11px] text-muted-foreground/50">
                            {t("settings.agentsNoTags")}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="settings-card-actions flex items-center gap-1.5">
                      <AgentActivationSwitch
                        checked={template.enabled}
                        title={template.enabled ? t("settings.disable") : t("settings.enable")}
                        onToggle={() => handleToggleEnabled(template.id)}
                      />
                      <div className="settings-hover-actions ml-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(template)}
                          title={t("settings.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <ConfirmDeletePopover
                          name={template.name}
                          onConfirm={() => handleDelete(template.id)}
                        >
                          {(open) => (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={open}
                              title={t("settings.delete")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </ConfirmDeletePopover>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border/40 px-4 py-2.5">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {template.description || t("settings.agentsNoDescription")}
                    </p>
                    {template.prompt ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : template.id)}
                        className="mt-2 flex w-full items-center gap-1.5 text-left text-[11px] font-medium text-muted-foreground/70 transition-colors hover:text-muted-foreground"
                      >
                        <Terminal className="h-3 w-3" />
                        <span>
                          {isExpanded
                            ? t("settings.agentsHidePrompt")
                            : t("settings.agentsShowPrompt")}
                        </span>
                        <ChevronRight
                          className={`ml-auto h-3 w-3 transition-transform ${
                            isExpanded ? "rotate-90" : ""
                          }`}
                        />
                      </button>
                    ) : null}
                    {isExpanded ? (
                      <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground/80">
                        <pre className="whitespace-pre-wrap break-words">
                          {template.prompt}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen ? (
        <AgentPromptTemplateModal
          initialData={editingTemplate ?? undefined}
          onSave={handleSave}
          onClose={closeModal}
        />
      ) : null}
    </>
  );
}
