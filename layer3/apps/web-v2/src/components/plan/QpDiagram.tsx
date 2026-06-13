import { useEffect, useRef } from "react";
import { ensureQp, applyHeatColoring, bindQpActions, drawLines } from "@/lib/qp-loader";

interface Props {
  xml: string;
  onError?: (msg: string) => void;
}

// Force light theme — qp.css is designed for light mode only.
// Override --qp-block-height so .qp-statement-block fills the available
// space instead of trying to be min(86vh, ...).
const QP_WRAP_STYLE = {
  background: "#ffffff",
  colorScheme: "light",
  "--qp-block-height": "calc(100vh - 260px)",
  "--qp-block-height-dvh": "calc(100dvh - 260px)",
} as React.CSSProperties;

export function QpDiagram({ xml, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !xml.trim()) return;

    let cancelled = false;

    ensureQp()
      .then(() => {
        if (cancelled || !container || !window.QP) return;
        try {
          const doc = new DOMParser().parseFromString(xml, "application/xml");
          if (doc.getElementsByTagName("parsererror").length > 0) {
            onError?.("Invalid XML — parse error. Please check the plan XML.");
            return;
          }
          container.innerHTML = "";
          window.QP.showPlan(container, xml);
          applyHeatColoring(container);
          bindQpActions(container, xml);
          // Draw SVG connector lines ONLY after browser layout is done.
          // Do NOT call synchronously — nodes not yet positioned.
          // Do NOT call twice — drawLines appends a new SVG each time.
          setTimeout(() => { if (!cancelled) drawLines(container); }, 150);
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "Render failed");
        }
      })
      .catch(err => {
        if (!cancelled) onError?.(err instanceof Error ? err.message : "Failed to load diagram library");
      });

    return () => { cancelled = true; };
  }, [xml, onError]);

  return (
    <div data-theme="light" style={QP_WRAP_STYLE}>
      <div
        ref={containerRef}
        style={{ overflowX: "auto", overflowY: "visible", minHeight: 100 }}
        role="img"
        aria-label="SQL execution plan diagram"
      />
    </div>
  );
}
