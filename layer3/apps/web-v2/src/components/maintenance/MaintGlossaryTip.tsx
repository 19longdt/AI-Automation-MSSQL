import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { MAINT_GLOSSARY } from "./maintenance-glossary";

interface MaintGlossaryTipProps {
  glossaryKey: string;
  children: ReactNode;
  className?: string;
}

interface PopupPos {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

const TOOLTIP_WIDTH = 300;
const VIEWPORT_GAP = 12;
const ANCHOR_GAP = 8;

export function MaintGlossaryTip({ glossaryKey, children, className }: MaintGlossaryTipProps): ReactNode {
  const entry = MAINT_GLOSSARY[glossaryKey];
  const rootRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
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
      if (event.key === "Escape") setOpen(false);
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
      const measuredHeight = tipRef.current?.offsetHeight ?? 100;
      const fitsBelow = rect.bottom + ANCHOR_GAP + measuredHeight <= window.innerHeight - VIEWPORT_GAP;
      const placement: PopupPos["placement"] = fitsBelow ? "bottom" : "top";
      const centeredLeft = rect.left + rect.width / 2 - width / 2;
      const left = Math.max(VIEWPORT_GAP, Math.min(centeredLeft, window.innerWidth - width - VIEWPORT_GAP));
      const top =
        placement === "bottom"
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

  if (!entry) return <>{children}</>;

  return (
    <>
      <span ref={rootRef} className={cn("inline-flex items-center gap-1", className)}>
        <span>{children}</span>
        <button
          type="button"
          aria-label={`Giải thích: ${entry.term}`}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[9px] font-bold leading-none text-[var(--color-muted)] transition-colors hover:bg-[var(--color-primary-soft)] hover:text-[var(--color-primary)]"
        >
          ?
        </button>
      </span>

      {open && popupPos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            className="fixed z-[9999] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-xl"
            style={{
              top: `${popupPos.top}px`,
              left: `${popupPos.left}px`,
              width: `${Math.min(TOOLTIP_WIDTH, window.innerWidth - VIEWPORT_GAP * 2)}px`,
            }}
          >
            <div className="mb-1 text-[12px] font-semibold text-[var(--color-text)]">{entry.term}</div>
            <div className="text-[12px] leading-relaxed text-[var(--color-muted)]">{entry.description}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
