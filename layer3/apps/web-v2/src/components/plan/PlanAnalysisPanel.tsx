import { ChevronDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { PlanAnalysisResult, StatementResult } from "@layer3/core";
import { cn } from "@/lib/utils";
import { GlossaryTip } from "./GlossaryTip";
import { PlanSection } from "./PlanSection";
import { PlanSummaryBar } from "./PlanSummaryBar";
import { PlanCompilation } from "./sections/PlanCompilation";
import { PlanIndexUsage } from "./sections/PlanIndexUsage";
import { PlanIoStats } from "./sections/PlanIoStats";
import { PlanJoinTypes } from "./sections/PlanJoinTypes";
import { PlanLookupQueries } from "./sections/PlanLookupQueries";
import { PlanMemoryGrant } from "./sections/PlanMemoryGrant";
import { PlanMissingIndexes } from "./sections/PlanMissingIndexes";
import { PlanOperators } from "./sections/PlanOperators";
import { PlanParameters } from "./sections/PlanParameters";
import { PlanQueryText } from "./sections/PlanQueryText";
import { PlanRowEst } from "./sections/PlanRowEst";
import { PlanStatistics } from "./sections/PlanStatistics";
import { PlanWaitStats } from "./sections/PlanWaitStats";
import { PlanWarnings } from "./sections/PlanWarnings";

interface Props {
  result: PlanAnalysisResult;
}

interface GroupConfig {
  id: string;
  title: string;
  color: string;
  description: string;
}

const GROUPS: GroupConfig[] = [
  { id: "orientation", title: "Orientation", color: "var(--group-color-orientation)", description: "Query text and plan warnings" },
  { id: "cost", title: "Cost Analysis", color: "var(--group-color-cost)", description: "Operators, row estimates and I/O" },
  { id: "actionable", title: "Actionable", color: "var(--group-color-actionable)", description: "Indexes, statistics and parameters" },
  { id: "context", title: "Context", color: "var(--group-color-context)", description: "Indexes used, joins, memory and waits" },
  { id: "deepdive", title: "Deep Dive", color: "var(--group-color-deepdive)", description: "Compilation details and lookup SQL" },
];

export function PlanAnalysisPanel({ result }: Props): ReactNode {
  const [activeStmt, setActiveStmt] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(["cost", "actionable", "context", "deepdive"]),
  );
  const statements = result.statements ?? [];
  const statement = statements[activeStmt];

  const groups = useMemo(() => {
    if (!statement) return [];
    return buildGroups(statement);
  }, [statement]);

  if (!statement) {
    return <p className="py-8 text-center text-[13px] text-[var(--color-muted)]">No statements parsed.</p>;
  }

  function toggleGroup(id: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col">
      {statements.length > 1 && (
        <div className="flex gap-1 overflow-x-auto px-4 pt-3">
          {statements.map((_, index) => (
            <button
              key={`stmt-${index}`}
              type="button"
              onClick={() => setActiveStmt(index)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors",
                index === activeStmt
                  ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-row-hover)]",
              )}
            >
              Stmt {index + 1}
            </button>
          ))}
        </div>
      )}

      <PlanSummaryBar s={statement} />

      <div className="flex flex-col gap-3 px-4 py-4">
        {groups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.id);
          return (
            <section key={group.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <header
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
                className="cursor-pointer select-none border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] focus-visible:outline-offset-[-2px] focus-visible:rounded-xl"
                onClick={() => toggleGroup(group.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(group.id); } }}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                  <span className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: group.color }}>
                    {group.title}
                  </span>
                  <span className="text-[11px] text-[var(--color-muted)]">
                    <GlossaryTip glossaryKey={`group_${group.id}`}>· {group.description}</GlossaryTip>
                  </span>
                  <ChevronDown
                    className={cn(
                      "ml-auto h-4 w-4 text-[var(--color-muted)] transition-transform duration-150 motion-reduce:transition-none",
                      !isCollapsed && "rotate-180",
                    )}
                  />
                </div>
              </header>
              <div className={cn(
                "grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none",
                isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
              )}>
                <div className="overflow-hidden">
                  <div className="space-y-2.5 p-3">{renderGroup(group.id, statement, group.color)}</div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function renderGroup(groupId: string, statement: StatementResult, groupColor: string): ReactNode {
  if (groupId === "orientation") {
    return (
      <>
        <PlanSection title="Query Text" dotColor="blue" groupColor={groupColor}>
          <PlanQueryText statementText={statement.statement_text} />
        </PlanSection>
        {statement.finding_groups.length > 0 && (
          <PlanSection
            title="Warnings"
            dotColor="red"
            count={statement.finding_groups.reduce((sum, group) => sum + group.count, 0)}
            groupColor={groupColor}
          >
            <PlanWarnings groups={statement.finding_groups} />
          </PlanSection>
        )}
      </>
    );
  }

  if (groupId === "cost") {
    const rowMismatchCount = statement.top_operators.filter((item) => item.has_row_est_off).length;
    return (
      <>
        {statement.top_operators.length > 0 && (
          <PlanSection title="Top Operators" dotColor="yellow" count={statement.top_operators.length} groupColor={groupColor}>
            <PlanOperators operators={statement.top_operators} />
          </PlanSection>
        )}
        {rowMismatchCount > 0 && (
          <PlanSection title="Est vs Actual" dotColor="red" count={rowMismatchCount} groupColor={groupColor}>
            <PlanRowEst operators={statement.top_operators} />
          </PlanSection>
        )}
        {statement.io_stats.length > 0 && (
          <PlanSection title="I/O Statistics" dotColor="blue" count={statement.io_stats.length} groupColor={groupColor}>
            <PlanIoStats stats={statement.io_stats} />
          </PlanSection>
        )}
      </>
    );
  }

  if (groupId === "actionable") {
    return (
      <>
        {statement.missing_indexes.length > 0 && (
          <PlanSection title="Missing Indexes" dotColor="yellow" count={statement.missing_indexes.length} defaultOpen groupColor={groupColor}>
            <PlanMissingIndexes indexes={statement.missing_indexes} />
          </PlanSection>
        )}
        {statement.statistics.length > 0 && (
          <PlanSection title="Statistics" dotColor="yellow" count={statement.statistics.length} groupColor={groupColor}>
            <PlanStatistics statistics={statement.statistics} />
          </PlanSection>
        )}
        {statement.parameters.length > 0 && (
          <PlanSection title="Parameters" dotColor="blue" count={statement.parameters.length} groupColor={groupColor}>
            <PlanParameters parameters={statement.parameters} />
          </PlanSection>
        )}
      </>
    );
  }

  if (groupId === "context") {
    return (
      <>
        {statement.indexes_used.length > 0 && (
          <PlanSection title="Index Usage" dotColor="blue" count={statement.indexes_used.length} groupColor={groupColor}>
            <PlanIndexUsage items={statement.indexes_used} />
          </PlanSection>
        )}
        {statement.join_types.length > 0 && (
          <PlanSection title="Join Types" dotColor="blue" count={statement.join_types.length} groupColor={groupColor}>
            <PlanJoinTypes joins={statement.join_types} />
          </PlanSection>
        )}
        {statement.memory_grant && (
          <PlanSection title="Memory Grant" dotColor="yellow" groupColor={groupColor}>
            <PlanMemoryGrant grant={statement.memory_grant} />
          </PlanSection>
        )}
        {statement.wait_stats.length > 0 && (
          <PlanSection title="Wait Stats" dotColor="red" count={statement.wait_stats.length} groupColor={groupColor}>
            <PlanWaitStats waits={statement.wait_stats} />
          </PlanSection>
        )}
      </>
    );
  }

  return (
    <>
      {statement.compilation && (
        <PlanSection title="Compilation" dotColor="green" groupColor={groupColor}>
          <PlanCompilation compilation={statement.compilation} />
        </PlanSection>
      )}
      {statement.compilation?.lookup_queries && (
        <PlanSection title="Lookup Queries" dotColor="green" groupColor={groupColor}>
          <PlanLookupQueries queries={statement.compilation.lookup_queries} />
        </PlanSection>
      )}
    </>
  );
}

function buildGroups(statement: StatementResult): GroupConfig[] {
  return GROUPS.filter((group) => {
    if (group.id === "orientation") return true;
    if (group.id === "cost") return statement.top_operators.length > 0 || statement.io_stats.length > 0;
    if (group.id === "actionable") {
      return statement.missing_indexes.length > 0 || statement.statistics.length > 0 || statement.parameters.length > 0;
    }
    if (group.id === "context") {
      return statement.indexes_used.length > 0 || statement.join_types.length > 0 || statement.memory_grant != null || statement.wait_stats.length > 0;
    }
    return statement.compilation != null;
  });
}
