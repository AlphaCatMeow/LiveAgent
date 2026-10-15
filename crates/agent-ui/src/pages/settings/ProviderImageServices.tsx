import { type ReactNode, useCallback, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import type { ImageStudioClient } from "../../lib/imaging/types";
import { ImageSettings } from "./ImageSettings";

export function ProviderImageServices({
  children,
  navigationLabel = "供应商能力",
  client,
  registerLeaveGuard,
}: {
  children: ReactNode;
  navigationLabel?: string;
  client?: ImageStudioClient;
  registerLeaveGuard: (guard: () => boolean) => () => void;
}) {
  const [tab, setTab] = useState<"chat" | "image">("chat");
  const localGuard = useRef<(() => boolean) | undefined>(undefined);
  const register = useCallback(
    (guard: () => boolean) => {
      localGuard.current = guard;
      const unregister = registerLeaveGuard(guard);
      return () => {
        if (localGuard.current === guard) localGuard.current = undefined;
        unregister();
      };
    },
    [registerLeaveGuard],
  );
  const select = (next: "chat" | "image") => {
    if (next !== tab && localGuard.current && !localGuard.current()) return;
    setTab(next);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <nav className="flex shrink-0 gap-2" aria-label={navigationLabel}>
        <Button
          variant={tab === "chat" ? "secondary" : "ghost"}
          aria-pressed={tab === "chat"}
          onClick={() => select("chat")}
        >
          对话模型
        </Button>
        <Button
          variant={tab === "image" ? "secondary" : "ghost"}
          aria-pressed={tab === "image"}
          onClick={() => select("image")}
        >
          图像服务
        </Button>
      </nav>
      {tab === "chat" ? (
        children
      ) : client ? (
        <ImageSettings panel="connections" client={client} registerLeaveGuard={register} />
      ) : (
        <p role="status">当前后端不支持图像服务，请升级后端。</p>
      )}
    </div>
  );
}
