import { AppHeaderFrame } from "@liveagent/ui/application/AppWorkbenchChrome";
import { ArrowLeft } from "@liveagent/ui/components/IconSet";
import { Button } from "@liveagent/ui/components/ui/button";
import { useLocale } from "@liveagent/ui/i18n/index";
import { isWindowsTauriRuntime, WindowsTitleBar } from "./WindowsTitleBar";

export function WindowsSettingsHeader({ onBack }: { onBack: () => void }) {
  const { t } = useLocale();
  if (!isWindowsTauriRuntime()) return null;

  return (
    <AppHeaderFrame>
      <header
        data-windows-settings-header=""
        data-tauri-drag-region
        className="relative flex h-full items-center gap-4 pl-4"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          title={t("settings.backToChatHint")}
          aria-label={t("settings.backToChat")}
          className="rounded-lg text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4.5" />
        </Button>
        <div data-tauri-drag-region className="flex h-full min-w-0 flex-1 items-center">
          <span className="pointer-events-none truncate text-sm font-medium">
            {t("settings.title")}
          </span>
        </div>
        <WindowsTitleBar controlsOnly />
      </header>
    </AppHeaderFrame>
  );
}
