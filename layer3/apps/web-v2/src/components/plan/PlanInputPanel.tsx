import { useRef } from "react";
import { Upload, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onAnalyze: () => void;
  isLoading: boolean;
}

export function PlanInputPanel({ value, onChange, onAnalyze, isLoading }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange(String(ev.target?.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange(String(ev.target?.result ?? ""));
    reader.readAsText(file);
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-[var(--color-text)]">Execution Plan XML</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileRef.current?.click()}
          aria-label="Upload XML file"
        >
          <Upload className="w-3.5 h-3.5" /> Upload
        </Button>
        <input ref={fileRef} type="file" accept=".xml,.sqlplan" className="hidden" onChange={handleFile} />
      </div>

      <div
        className="flex-1 relative rounded-lg border border-[var(--color-border-2)] bg-[var(--color-surface-2)] overflow-hidden min-h-[200px]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste execution plan XML here, or drop a .sqlplan file…"
          className="w-full h-full p-3 resize-none bg-transparent font-code text-[12px] text-[var(--color-text)] placeholder-[var(--color-subtle)] focus:outline-none"
          aria-label="Execution plan XML input"
          spellCheck={false}
        />
        {!value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
            <Upload className="w-10 h-10 text-[var(--color-muted)]" />
          </div>
        )}
      </div>

      <Button
        variant="primary"
        size="lg"
        onClick={onAnalyze}
        disabled={!value.trim()}
        loading={isLoading}
        className="w-full"
        aria-label="Analyze execution plan"
      >
        <Zap className="w-4 h-4" />
        {isLoading ? "Analyzing…" : "Analyze Plan"}
      </Button>

      {value && (
        <p className="text-[11px] text-[var(--color-muted)] text-center">
          {value.length.toLocaleString()} chars
        </p>
      )}
    </div>
  );
}
