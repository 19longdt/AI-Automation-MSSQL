export function AiStatusBadge({ analyzed }: { analyzed: boolean }) {
  return analyzed ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-success-soft)] text-[var(--color-success)] border border-[color:color-mix(in_srgb,var(--color-success)_30%,transparent)]">
      Done
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-warning-soft)] text-[var(--color-warning)] border border-[color:color-mix(in_srgb,var(--color-warning)_30%,transparent)]">
      Pending
    </span>
  );
}
