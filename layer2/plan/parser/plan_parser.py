from __future__ import annotations

import xml.etree.ElementTree as ET

from .index_parser import IndexParser
from .operator_parser import OperatorParser
from .statement_parser import StatementParser
from ..models.parsed_plan import ParsedPlan

SHOWPLAN_URI = "http://schemas.microsoft.com/sqlserver/2004/07/showplan"


class PlanParseError(Exception):
    pass


class PlanParser:
    def __init__(
        self,
        statement_parser: StatementParser,
        operator_parser: OperatorParser,
        index_parser: IndexParser,
    ) -> None:
        self._statement_parser = statement_parser
        self._operator_parser = operator_parser
        self._index_parser = index_parser

    def parse(self, xml: str) -> ParsedPlan:
        try:
            root = ET.fromstring(xml)
        except ET.ParseError as exc:
            raise PlanParseError(f"Invalid XML: {exc}") from exc

        statements = []
        for stmt_el in root.iter(self._tag("StmtSimple")):
            stmt = self._statement_parser.parse(stmt_el)
            if stmt is None:
                continue
            self._index_parser.parse_into(stmt, stmt_el)
            self._operator_parser.parse_into(stmt, stmt_el)
            statements.append(stmt)

        return ParsedPlan(statements=statements, build_version=root.get("Version"))

    def _tag(self, name: str) -> str:
        return f"{{{SHOWPLAN_URI}}}{name}"
