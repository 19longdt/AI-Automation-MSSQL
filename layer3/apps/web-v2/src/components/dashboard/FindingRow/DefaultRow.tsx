import { useState } from "react";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { AlertStatusBadge } from "@/components/shared/AlertStatusBadge";
import { RoleNodeCell } from "@/components/shared/RoleNodeCell";
import { FindingDetailModal } from "@/components/dashboard/modals/FindingDetailModal";
import { formatDetectedAt } from "@/lib/format";
import type { FindingWithAnalysis } from "@/types";
import type { Severity } from "@layer3/core";

const TH = "px-3 py-2 text-left text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide whitespace-nowrap";
const TD = "px-3 py-2.5 text-[13px] align-middle";

export function DefaultHeader() {
  return (
    <tr>
      {["Time","Severity","Issue Type","Node","Alert","AI"].map((h) => (
        <th key={h} className={TH}>{h}</th>
      ))}
    </tr>
  );
}

export function DefaultRow({ finding }: { finding: FindingWithAnalysis; onOpen: (f: FindingWithAnalysis) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        className="border-b border-[var(--color-border)] hover:bg-[var(--color-row-hover)] cursor-pointer transition-colors"
        onClick={() => setOpen(true)}
      >
        <td className={TD}><span className="font-code text-[11px] text-[var(--color-muted)]">{formatDetectedAt(finding.detected_at)}</span></td>
        <td className={TD}><SeverityBadge severity={finding.severity as Severity} /></td>
        <td className={TD}><span className="text-[var(--color-text)]">{finding.issue_type?.replace(/_/g," ")}</span></td>
        <td className={TD}><RoleNodeCell role={finding.role} node={finding.node} /></td>
        <td className={TD}><AlertStatusBadge status={finding.alert_status ?? ""} /></td>
        <td className={TD}>
          {finding.ai_analyzed
            ? <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success)]">✓ Analyzed</span>
            : <span className="text-[11px] text-[var(--color-subtle)]">—</span>
          }
        </td>
      </tr>

      {open && <FindingDetailModal finding={finding} onClose={() => setOpen(false)} />}
    </>
  );
}
