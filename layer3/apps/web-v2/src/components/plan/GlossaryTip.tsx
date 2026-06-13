import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { GLOSSARY } from "./glossary";

interface GlossaryTipProps {
  glossaryKey: string;
  children: ReactNode;
  className?: string;
}

interface PopupPos {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

const TOOLTIP_WIDTH = 320;
const VIEWPORT_GAP = 12;
const ANCHOR_GAP = 10;

export function GlossaryTip({ glossaryKey, children, className }: GlossaryTipProps): ReactNode {
  const entry = GLOSSARY[glossaryKey];
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<PopupPos | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !tipRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;

    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;

      const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
      const measuredHeight = tipRef.current?.offsetHeight ?? 180;
      const fitsBelow = rect.bottom + ANCHOR_GAP + measuredHeight <= window.innerHeight - VIEWPORT_GAP;
      const placement: PopupPos["placement"] = fitsBelow ? "bottom" : "top";

      const centeredLeft = rect.left + rect.width / 2 - width / 2;
      const left = Math.max(VIEWPORT_GAP, Math.min(centeredLeft, window.innerWidth - width - VIEWPORT_GAP));
      const top = placement === "bottom"
        ? rect.bottom + ANCHOR_GAP
        : Math.max(VIEWPORT_GAP, rect.top - measuredHeight - ANCHOR_GAP);

      setPopupPos({ top, left, placement });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  if (!entry) {
    return <>{children}</>;
  }

  return (
    <>
      <span ref={rootRef} className={cn("gl-tip-wrap", className)}>
        <span className="gl-tip-label">{children}</span>
        <button
          type="button"
          className="gl-tip-btn"
          aria-label={`Glossary: ${entry.term}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          ?
        </button>
      </span>
      {open && popupPos && typeof document !== "undefined" && createPortal(
        <span
          ref={tipRef}
          className="gl-tooltip"
          data-placement={popupPos.placement}
          role="tooltip"
          style={{ top: `${popupPos.top}px`, left: `${popupPos.left}px`, width: `${Math.min(TOOLTIP_WIDTH, window.innerWidth - VIEWPORT_GAP * 2)}px` }}
        >
          <span className="gl-tooltip-term">{entry.term}</span>
          <span className="gl-tooltip-def">{entry.definition}</span>
          {entry.threshold && (
            <span className="gl-tooltip-row">
              <span className="gl-tooltip-label">Threshold</span>
              <span className="gl-tooltip-val">{entry.threshold}</span>
            </span>
          )}
          <span className="gl-tooltip-row">
            <span className="gl-tooltip-label">Impact</span>
            <span className="gl-tooltip-val">{entry.impact}</span>
          </span>
          {entry.formula && <span className="gl-tooltip-formula">{entry.formula}</span>}
        </span>,
        document.body,
      )}
    </>
  );
}
