from __future__ import annotations

from enum import Enum


class AnalysisType(str, Enum):
    PLAN_XML = "plan_xml"
    # Future: WAIT_STATS = "wait_stats"
    # Future: BLOCKING_CHAIN = "blocking_chain"
    # Future: INDEX_FRAGMENTATION = "index_fragmentation"
