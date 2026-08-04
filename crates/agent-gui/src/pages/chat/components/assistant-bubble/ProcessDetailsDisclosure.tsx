import { memo, type ReactNode, useId, useState } from "react";

import { ChevronRight, Lightbulb } from "../../../../components/icons";
import { useLocale } from "../../../../i18n";
import {
  readManualProcessDetailsOpen,
  writeManualProcessDetailsOpen,
} from "../../../../lib/chat/processDetailsDisclosureState";
import { getProcessDetailsDefaultOpen } from "../../../../lib/chat/processDetailsModel";
import { LazyCollapse } from "./LazyCollapse";

export const ProcessDetailsDisclosure = memo(function ProcessDetailsDisclosure(props: {
  disclosureKey: string;
  hasSubstantiveAnswer: boolean;
  isStreaming?: boolean;
  expandByDefault: boolean;
  forceOpen?: boolean;
  retainWhileClosed?: boolean;
  children: () => ReactNode;
}) {
  const {
    disclosureKey,
    hasSubstantiveAnswer,
    isStreaming = false,
    expandByDefault,
    forceOpen = false,
    retainWhileClosed = false,
    children,
  } = props;
  const { t } = useLocale();
  const regionId = useId();
  const toggleId = `${regionId}-toggle`;
  const automaticOpen =
    forceOpen ||
    getProcessDetailsDefaultOpen({
      hasSubstantiveAnswer: hasSubstantiveAnswer && !isStreaming,
      expandByDefault,
    });
  const [manualOpen, setManualOpen] = useState(() => readManualProcessDetailsOpen(disclosureKey));
  const open = manualOpen ?? automaticOpen;

  return (
    <div className="process-details min-w-0 max-w-full">
      <button
        id={toggleId}
        type="button"
        aria-controls={regionId}
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setManualOpen(next);
          writeManualProcessDetailsOpen(disclosureKey, next);
        }}
        className="process-details-toggle flex w-full cursor-pointer select-none items-center gap-2 rounded-md py-1.5 text-left text-[calc(13px*var(--zone-font-scale,1))] font-normal text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px"
      >
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <span>{t("chat.processDetails")}</span>
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200 ease-out ${open ? "rotate-90" : ""}`}
        />
      </button>
      <section id={regionId} aria-labelledby={toggleId}>
        <LazyCollapse open={open} retainWhileClosed={retainWhileClosed}>
          {() => <div className="space-y-1 pb-1 pt-1">{children()}</div>}
        </LazyCollapse>
      </section>
    </div>
  );
});
