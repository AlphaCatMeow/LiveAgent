import type { PlanningBackend } from "@liveagent/ui/lib/planning/types";
import { getConfiguredKBrainConnection } from "../kbrain/runtimeConnection";
import { requestPlanning } from "./kbrain";
export const backend: PlanningBackend = {
  scope: () => getConfiguredKBrainConnection()?.baseUrl ?? "",
  call: requestPlanning,
  subscribe(listener) {
    const timer = setInterval(() => listener(), 2_000);
    const refresh = () => listener();
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  },
};
