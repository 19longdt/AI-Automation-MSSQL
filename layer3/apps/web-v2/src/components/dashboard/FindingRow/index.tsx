import type { FindingWithAnalysis } from "@/types";
import { SlowSessionRow, SlowSessionHeader } from "./SlowSessionRow";
import { BlockingRow, BlockingHeader } from "./BlockingRow";
import { AgHealthRow, AgHealthHeader } from "./AgHealthRow";
import { DeadlockRow, DeadlockHeader } from "./DeadlockRow";
import { AgRedoSecondaryRow, AgRedoSecondaryHeader } from "./AgRedoSecondaryRow";
import { CdcHealthRow, CdcHealthHeader } from "./CdcHealthRow";
import { DefaultRow, DefaultHeader } from "./DefaultRow";

export interface RowRenderer {
  Header: React.FC;
  Row: React.FC<{ finding: FindingWithAnalysis; onOpen: (f: FindingWithAnalysis) => void }>;
}

export function getTopicRowRenderer(topicId: string): RowRenderer {
  switch (topicId) {
    case "slow_sessions": return { Header: SlowSessionHeader, Row: SlowSessionRow };
    case "blocking":      return { Header: BlockingHeader,    Row: BlockingRow     };
    case "ag_health":         return { Header: AgHealthHeader,         Row: AgHealthRow          };
    case "ag_redo_secondary": return { Header: AgRedoSecondaryHeader,   Row: AgRedoSecondaryRow   };
    case "deadlock":          return { Header: DeadlockHeader,          Row: DeadlockRow          };
    case "cdc_health":        return { Header: CdcHealthHeader,         Row: CdcHealthRow         };
    default:                  return { Header: DefaultHeader,           Row: DefaultRow           };
  }
}
