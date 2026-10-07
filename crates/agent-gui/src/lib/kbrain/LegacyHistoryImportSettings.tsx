import { Button } from "@liveagent/ui/components/ui/button";
import { useLocale } from "@liveagent/ui/i18n";
import { SettingsGroup, SettingsRow } from "@liveagent/ui/pages/settings/shared";
import { useSyncExternalStore } from "react";
import { isTauriHost } from "../host";
import {
  getHistoryImportState,
  importOldConversations,
  subscribeHistoryImport,
} from "./manualHistoryImport";

export function LegacyHistoryImportSettings() {
  const { t } = useLocale();
  const state = useSyncExternalStore(subscribeHistoryImport, getHistoryImportState);
  const desktop = isTauriHost();
  const result = state.result;
  const imported = result?.results.filter((item) => item.status === "imported").length ?? 0;
  const existing = result?.results.filter((item) => item.status === "already_imported").length ?? 0;
  const incomplete =
    result?.results.filter(
      (item) => item.checkpoint === "partial" || item.checkpoint === "unresolved",
    ).length ?? 0;
  const summary = t("historyImport.result")
    .replace("{imported}", String(imported))
    .replace("{existing}", String(existing))
    .replace("{failed}", String(result?.failures.length ?? 0));
  return (
    <SettingsGroup title={t("historyImport.title")}>
      <SettingsRow
        title={t("historyImport.action")}
        description={t(desktop ? "historyImport.description" : "historyImport.desktopOnly")}
        control={
          <Button
            data-testid="import-legacy-history"
            disabled={!desktop || state.running}
            onClick={() => void importOldConversations()}
          >
            {t(state.running ? "historyImport.running" : "historyImport.action")}
          </Button>
        }
      />
      <div
        role="status"
        aria-live="polite"
        className="space-y-2 break-words text-sm"
        data-testid="legacy-history-import-result"
      >
        {state.running && <p>{t("historyImport.runningHint")}</p>}
        {result && (
          <>
            <p>{summary}</p>
            {result.results.length === 0 && result.failures.length === 0 && (
              <p>{t("historyImport.empty")}</p>
            )}
            {incomplete > 0 && (
              <p>{t("historyImport.partial").replace("{count}", String(incomplete))}</p>
            )}
            {result.failures.length > 0 && (
              <details>
                <summary>{t("historyImport.failures")}</summary>
                <ul className="max-h-48 overflow-y-auto">
                  {result.failures.map((failure, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a static report of one import run; rows never reorder
                    <li key={`${failure.sourceId}:${index}`}>
                      {failure.sourceId}: {failure.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {state.error && <p>{state.error}</p>}
      </div>
    </SettingsGroup>
  );
}
