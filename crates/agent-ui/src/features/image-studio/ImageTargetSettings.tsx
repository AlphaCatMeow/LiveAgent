import { useCallback, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import type { ImageStudioClient } from "../../lib/imaging/types";
import { ImageSettings } from "../../pages/settings/ImageSettings";

export function ImageTargetSettings({ client }: { client: ImageStudioClient }) {
  const [open, setOpen] = useState(false);
  const guard = useRef<(() => boolean) | undefined>(undefined);
  const register = useCallback((next: () => boolean) => {
    guard.current = next;
    return () => {
      if (guard.current === next) guard.current = undefined;
    };
  }, []);
  const close = () => {
    if (!guard.current || guard.current()) setOpen(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        目标设置
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden"
        showCloseButton={false}
      >
        <header className="flex items-center justify-between gap-3">
          <DialogTitle>输入设置 · 图像目标</DialogTitle>
          <Button type="button" variant="ghost" onClick={close}>
            关闭目标设置
          </Button>
        </header>
        <div className="min-h-0 overflow-auto">
          <ImageSettings client={client} panel="targets" registerLeaveGuard={register} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
