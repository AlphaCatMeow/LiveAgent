/**
 * 宿主能力缺失的识别。桌面宿主命令在另外两个运行面上不存在：K-brain 浏览器
 * 宿主（`shims/tauriCore` 直接拒绝）与 Gateway WebUI（`shims/tauriCore` 的
 * switch 未覆盖）。这两类文案是给开发者看的内部诊断，不是用户操作失败——
 * 顶在输入框下方或设置页里只会让人以为自己的仓库/驱动坏了。
 *
 * 调用方据此改用自己的本地化提示；真实失败（权限、路径、网络）原样透出。
 */
export function isHostCommandUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /unavailable in K-brain (browser )?mode/i.test(message) ||
    /WebUI shim does not implement/i.test(message)
  );
}
