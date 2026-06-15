import { useEffect, useRef } from "react";
import { renderQueryPlan } from "@/lib/qp";

interface Props {
  xml: string;
  ariaLabel: string;
  onError?: (msg: string) => void;
  compact?: boolean;
  style?: React.CSSProperties;
}

export function QpCanvas({ xml, ariaLabel, onError, compact = false, style }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !xml.trim()) return;

    let cancelled = false;
    renderQueryPlan(container, xml)
      .catch(err => {
        if (!cancelled) onError?.(err instanceof Error ? err.message : "Failed to render query plan");
      });

    return () => {
      cancelled = true;
    };
  }, [xml, onError]);

  return (
    <div className={compact ? "qp-viewer qp-viewer--compact" : "qp-viewer"}>
      <div className={compact ? "qp-viewer__scroll qp-viewer__scroll--compact" : "qp-viewer__scroll"}>
        <div
          ref={containerRef}
          className="qp-viewer__container"
          style={style}
          role="img"
          aria-label={ariaLabel}
        />
      </div>
    </div>
  );
}
