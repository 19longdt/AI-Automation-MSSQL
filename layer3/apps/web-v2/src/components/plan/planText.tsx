import type { ReactNode } from "react";

export function renderText(source: string | null | undefined): ReactNode {
  const text = source ?? "";
  if (!text) return null;

  const parts = text.split(/(`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${part}-${index}`}
          className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-code text-[11px] text-[var(--color-text)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

