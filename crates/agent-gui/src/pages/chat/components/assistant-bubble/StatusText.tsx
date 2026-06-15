import { useLocale } from "../../../../i18n";
import { VIBING_STATUS } from "../../../../lib/chat/page/chatPageHelpers";
import { cn } from "../../../../lib/shared/utils";

export function VibingText({ className }: { className?: string }) {
  return <AnimatedStatusText text={VIBING_STATUS} className={className} />;
}

export function CompactingText({ className }: { className?: string }) {
  const { t } = useLocale();
  return <AnimatedStatusText text={t("chat.compactingContext")} className={className} />;
}

function AnimatedStatusText(props: { text: string; className?: string }) {
  const { text, className } = props;
  const seenCharacters = new Map<string, number>();
  const characters = Array.from(text, (char, delayIndex) => {
    const count = seenCharacters.get(char) ?? 0;
    seenCharacters.set(char, count + 1);
    return {
      char,
      delayIndex,
      key: `${char}-${count}`,
    };
  });

  return (
    <span className={cn("vibing-status", className)}>
      <span className="sr-only">{text}</span>
      {characters.map(({ char, delayIndex, key }) => (
        <span
          key={key}
          aria-hidden="true"
          className="vibing-status-char"
          style={{ animationDelay: `${delayIndex * 0.08}s` }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </span>
  );
}
