import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface CopySqlButtonProps {
  text: string;
  label: string;
  className?: string;
}

export function CopySqlButton({ text, label, className }: CopySqlButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timeoutId = window.setTimeout(() => setCopied(false), 1_200);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const handleCopy = useCallback(async (): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
    }
  }, [text]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => void handleCopy()}
      aria-label={`${copied ? "Copied" : "Copy"} ${label}`}
      className={className}
    >
      {copied ? "Copied!" : "Copy DDL"}
    </Button>
  );
}

