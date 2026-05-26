import { Popover } from "@base-ui/react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n";
import { AlertTriangle } from "../icons";
import { Button } from "./button";

export function ConfirmActionPopover(props: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  children: (open: () => void) => ReactNode;
}) {
  const { title, description, confirmLabel, onConfirm, children } = props;
  const { t } = useLocale();

  return (
    <Popover.Root>
      {/* Pass no-op — Popover.Trigger merges its own click handler via render prop */}
      <Popover.Trigger render={children(() => {}) as React.ReactElement} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-[9999]">
          <Popover.Popup className="w-64 rounded-xl border border-border bg-popover shadow-lg outline-none data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1">
            <div className="p-3">
              <div className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{title}</p>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {description}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Popover.Close
                  render={<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" />}
                >
                  {t("settings.cancel")}
                </Popover.Close>
                <Popover.Close
                  render={
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={onConfirm}
                    />
                  }
                >
                  {confirmLabel}
                </Popover.Close>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ConfirmDeletePopover(props: {
  name: string;
  onConfirm: () => void;
  children: (open: () => void) => ReactNode;
}) {
  const { t } = useLocale();

  return (
    <ConfirmActionPopover
      title={t("settings.deleteConfirm")}
      description={
        <>
          {t("settings.deleteConfirmYes")}{" "}
          <span className="font-medium text-foreground">{props.name}</span>？
          {t("settings.deleteConfirmDesc")}
        </>
      }
      confirmLabel={t("settings.delete")}
      onConfirm={props.onConfirm}
    >
      {props.children}
    </ConfirmActionPopover>
  );
}
