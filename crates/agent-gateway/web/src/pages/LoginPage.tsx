import { useState } from "react";
import { MessageSquareText, History, Timer, ArrowRight, Shield } from "../components/icons";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/shared/utils";

type LoginPageProps = {
  token: string;
  error: string | null;
  isSubmitting: boolean;
  onTokenChange: (token: string) => void;
  onSubmit: () => void;
};

const features = [
  {
    icon: MessageSquareText,
    title: "Remote Chat",
    desc: "按桌面端式样查看 token、thinking、tool_call 与 tool_result。",
    accent: "login-feature-accent-blue",
  },
  {
    icon: History,
    title: "History Resume",
    desc: "从远程历史回填会话并继续对话，而不是只看原始 JSON。",
    accent: "login-feature-accent-violet",
  },
  {
    icon: Timer,
    title: "Cron Control",
    desc: "在浏览器里完成任务查看、创建、更新与删除的转发调试。",
    accent: "login-feature-accent-amber",
  },
];

export function LoginPage({
  token,
  error,
  isSubmitting,
  onTokenChange,
  onSubmit,
}: LoginPageProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <main className="login-shell">
      {/* Ambient background glow */}
      <div className="login-bg-glow" aria-hidden="true" />

      <section className="login-card login-entrance">
        {/* Header */}
        <div className="login-header login-entrance-delay-1">
          <div className="login-badge">
            <Shield size={14} strokeWidth={2.5} />
            <span>LiveAgent Gateway</span>
          </div>
          <h1 className="login-title">连接 WebUI 控制台</h1>
          <p className="login-subtitle">
            输入部署在 Gateway 服务端的 Access Token。提交时会先校验，通过后才会进入对话页面并本地保存。
          </p>
        </div>

        {/* Feature grid */}
        <div className="login-feature-grid login-entrance-delay-2">
          {features.map((f) => (
            <div key={f.title} className={cn("login-feature", f.accent)}>
              <div className="login-feature-icon">
                <f.icon size={20} strokeWidth={1.8} />
              </div>
              <div>
                <strong>{f.title}</strong>
                <span>{f.desc}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Token input */}
        <div className={cn("login-field-group login-entrance-delay-3", isFocused && "login-field-group-focus")}>
          <label htmlFor="access-token" className="login-label">
            Access Token
          </label>
          <Textarea
            id="access-token"
            name="access_token"
            rows={3}
            value={token}
            placeholder="Bearer eyJhbGciOi..."
            disabled={isSubmitting}
            aria-invalid={error ? "true" : "false"}
            onChange={(e) => onTokenChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="login-token-input"
          />
          <p className="login-help">支持粘贴原始 token，或带 `Bearer ` 前缀的完整值。</p>
          {error ? <p className="login-error">{error}</p> : null}
        </div>

        {/* Submit */}
        <Button
          type="button"
          size="lg"
          disabled={token.trim() === "" || isSubmitting}
          onClick={onSubmit}
          className="login-submit login-entrance-delay-3"
        >
          {isSubmitting ? "验证中..." : "进入 Gateway"}
          {!isSubmitting ? <ArrowRight size={16} strokeWidth={2} /> : null}
        </Button>
      </section>
    </main>
  );
}
