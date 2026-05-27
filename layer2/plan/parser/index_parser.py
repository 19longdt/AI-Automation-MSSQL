from __future__ import annotations

import xml.etree.ElementTree as ET

from ..models.parsed_plan import MissingIndex, ParsedStatement, StatsUsageItem

SHOWPLAN_URI = "http://schemas.microsoft.com/sqlserver/2004/07/showplan"


class IndexParser:
    def parse_into(self, statement: ParsedStatement, stmt_el: ET.Element) -> None:
        for group in stmt_el.findall(f".//{self._tag('MissingIndexGroup')}"):
            impact = self._to_float(group.get("Impact"))
            for idx in group.findall(self._tag("MissingIndex")):
                mi = MissingIndex(
                    database=(idx.get("Database") or "").strip("[]"),
                    schema=(idx.get("Schema") or "").strip("[]"),
                    table=(idx.get("Table") or "").strip("[]"),
                    impact=impact,
                )
                for cg in idx.findall(self._tag("ColumnGroup")):
                    usage = (cg.get("Usage") or "").upper()
                    cols = [
                        (c.get("Name") or "").strip("[]")
                        for c in cg.findall(self._tag("Column"))
                        if c.get("Name")
                    ]
                    if usage == "EQUALITY":
                        mi.equality_columns = cols
                    elif usage == "INEQUALITY":
                        mi.inequality_columns = cols
                    elif usage == "INCLUDE":
                        mi.include_columns = cols
                statement.missing_indexes.append(mi)

        for s in stmt_el.findall(f".//{self._tag('OptimizerStatsUsage')}/{self._tag('StatisticsInfo')}"):
            table = (s.get("Table") or "").strip("[]")
            schema = (s.get("Schema") or "").strip("[]")
            statement.stats_usage.append(
                StatsUsageItem(
                    table=f"{schema}.{table}" if schema and table else table,
                    statistic=(s.get("Statistics") or "").strip("[]"),
                    modification_count=self._to_optional_int(s.get("ModificationCount")),
                    sampling_percent=self._to_optional_float(s.get("SamplingPercent")),
                    last_update=s.get("LastUpdate"),
                )
            )

    def _tag(self, name: str) -> str:
        return f"{{{SHOWPLAN_URI}}}{name}"

    def _to_float(self, value: str | None) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def _to_optional_int(self, value: str | None) -> int | None:
        try:
            return int(float(value)) if value is not None else None
        except (TypeError, ValueError):
            return None

    def _to_optional_float(self, value: str | None) -> float | None:
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None
