import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import {
  connectKBrainBackendWithRetry,
  createKBrainBootstrapRunner,
  notifyFrontendReady,
} from "./lib/kbrain/bootstrap";
import { migrateAllHistoryOnce } from "./lib/kbrain/historyMigration";
import { inferRuntimePlatform } from "./lib/runtimePlatform";
import { installWebviewNavigationGuard } from "./lib/system/webviewNavigationGuard";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

function renderBootstrapError(error: unknown, retry: () => void) {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <main className="flex size-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <h1 className="text-lg font-semibold">K-brain 后端启动失败</h1>
      <p className="max-w-xl text-sm text-muted-foreground">{message}</p>
      <button className="rounded-md border px-4 py-2 text-sm" type="button" onClick={retry}>
        重试
      </button>
    </main>,
  );
}

const bootstrap = createKBrainBootstrapRunner(async () => {
  try {
    await connectKBrainBackendWithRetry();
    const migration = await migrateAllHistoryOnce();
    if (migration.failures.length > 0) {
      console.warn("Legacy history migration incomplete", migration.failures);
    }
    const { default: App } = await import("./App");
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (error) {
    renderBootstrapError(error, () => void bootstrap());
  } finally {
    await notifyFrontendReady().catch(() => undefined);
  }
});

// F5/Ctrl+R 等 webview 内置浏览器行为会把整个应用当网页刷新/导航走——在 React
// 挂载前安装守卫。dev 下放行刷新组合键，保留本地整页重载的调试手段。
installWebviewNavigationGuard({
  isMac: inferRuntimePlatform() === "macos",
  allowReloadChords: import.meta.env.DEV,
});

if (import.meta.env.DEV) {
  // Dev console hook for transcript perf work: window.__seedLongConversation()
  void import("./lib/debug/seedLongConversation").then(({ seedLongConversation }) => {
    const devWindow = window as Window & { __seedLongConversation?: typeof seedLongConversation };
    devWindow.__seedLongConversation = seedLongConversation;
  });
}

void bootstrap();
