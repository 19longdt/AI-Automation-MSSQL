"""
threshold_detector.py — Generic: so sánh query result values với config thresholds.

Dùng cho: PLE, TempDB %, AG lag, backup gap, DBCC age, Resource Governor...
Thresholds hoàn toàn từ topic config — không hardcode trong Python.

Ví dụ topic config:
  thresholds:
    tempdb_usage_pct: { warning: 70, critical: 85 }
    ple_sec: { warning: 300, critical: 100 }

  extra:
    lower_is_worse_fields: ["ple_sec"]   # giá trị thấp hơn = xấu hơn
    issue_type: "memory_pressure"        # override IssueType cho toàn topic
    issue_type_map:                      # per-field override
      ple_sec: "memory_pressure"
      log_send_queue_size: "ag_lag"

Detector kiểm tra mỗi row trong query result:
  row["tempdb_usage_pct"] > 85 → CRITICAL finding
  row["ple_sec"] < 300 → WARNING finding (ngược hướng — giá trị thấp hơn = xấu hơn)
"""
from __future__ import annotations

import logging

from ..models.common import IssueType, Severity
from ..models.findings import Finding
from ..models.metrics import QueryResult
from ..models.topic import MonitorTopic, ThresholdConfig

logger = logging.getLogger(__name__)


class ThresholdDetector:

    def detect(self, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        """
        Với mỗi threshold field trong topic.thresholds:
          Tìm field tương ứng trong query result rows.
          So sánh value với warning/critical thresholds.
          Tạo Finding nếu vượt ngưỡng.
        """
        if not topic.thresholds:
            return []

        lower_is_worse: set[str] = set(topic.extra.get("lower_is_worse_fields", []))

        findings: list[Finding] = []
        for result in results:
            if not result.success:
                continue
            for row in result.rows:
                for field, threshold in topic.thresholds.items():
                    finding = self._check_row(
                        row=row,
                        field=field,
                        threshold=threshold,
                        topic=topic,
                        node=result.node,
                        role=result.role,
                        query_hash=result.query_id,
                        lower_is_worse=(field in lower_is_worse),
                    )
                    if finding is not None:
                        findings.append(finding)

        return findings

    def _check_row(
        self,
        row: dict,
        field: str,
        threshold: ThresholdConfig,
        topic: MonitorTopic,
        node: str,
        role: str = "",
        query_hash: str | None = None,
        lower_is_worse: bool = False,
    ) -> Finding | None:
        """Kiểm tra 1 row, 1 field. Trả về Finding hoặc None."""
        if field not in row or row[field] is None:
            return None

        try:
            value = float(row[field])
        except (TypeError, ValueError):
            logger.debug(
                "threshold_detector: cannot convert field=%s value=%r to float (topic=%s)",
                field, row[field], topic.topic_id,
            )
            return None

        if lower_is_worse:
            # Giá trị thấp hơn = tệ hơn (ví dụ PLE: thấp là áp lực bộ nhớ)
            if value <= threshold.critical:
                severity = Severity.CRITICAL
            elif value <= threshold.warning:
                severity = Severity.WARNING
            else:
                return None
        else:
            # Giá trị cao hơn = tệ hơn (ví dụ TempDB %, AG lag queue)
            if value >= threshold.critical:
                severity = Severity.CRITICAL
            elif value >= threshold.warning:
                severity = Severity.WARNING
            else:
                return None

        issue_type = self._resolve_issue_type(topic, field)

        # Include full row context trong metrics để AI có đủ data
        metrics: dict = {
            field: value,
            "threshold_warning": threshold.warning,
            "threshold_critical": threshold.critical,
        }
        # Thêm các field khác từ row (ví dụ replica_server_name, wait_type...)
        for k, v in row.items():
            if k != field and isinstance(v, (int, float, str, bool, type(None))):
                metrics[k] = v

        logger.info(
            "threshold_detector: FINDING topic=%s field=%s value=%s severity=%s node=%s",
            topic.topic_id, field, value, severity.value, node,
        )

        return Finding(
            topic_id=topic.topic_id,
            issue_type=issue_type,
            severity=severity,
            node=node,
            role=role,
            query_hash=query_hash,
            metrics=metrics,
        )

    def _resolve_issue_type(self, topic: MonitorTopic, field: str) -> IssueType:
        """
        Resolve IssueType theo thứ tự ưu tiên:
          1. topic.extra["issue_type_map"][field]  — per-field override
          2. topic.extra["issue_type"]             — topic-level override
          3. WAIT_ANOMALY                           — generic fallback
        """
        field_map: dict = topic.extra.get("issue_type_map", {})
        if field in field_map:
            try:
                return IssueType(field_map[field])
            except ValueError:
                logger.warning(
                    "threshold_detector: unknown issue_type '%s' in issue_type_map for field '%s'",
                    field_map[field], field,
                )

        raw = topic.extra.get("issue_type")
        if raw:
            try:
                return IssueType(raw)
            except ValueError:
                logger.warning(
                    "threshold_detector: unknown issue_type '%s' in topic.extra (topic=%s)",
                    raw, topic.topic_id,
                )

        return IssueType.WAIT_ANOMALY
