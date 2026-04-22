"""
baseline_detector.py — So sánh query results với day-of-week baseline.

Dùng cho: slow query, wait stats anomaly, blocked query trend.
Baseline = avg cùng ngày trong tuần + cùng giờ trong N tuần gần nhất.

KHÔNG dùng rolling 7-day average: workload pattern khác nhau theo ngày
(Thứ Hai peak, Chủ Nhật thấp) → rolling average gây false positives.
"""
from __future__ import annotations

import logging

from ..models.common import IssueType, Severity
from ..models.findings import Finding
from ..models.topic import BaselineConfig, MonitorTopic
from ..models.metrics import QueryResult
from ..storage.repositories.baseline_repo import BaselineRepo
from ..utils.time_utils import now_vn

logger = logging.getLogger(__name__)


class BaselineDetector:

    def __init__(self, baseline_repo: BaselineRepo) -> None:
        self._baseline_repo = baseline_repo

    def detect(self, results: list[QueryResult], topic: MonitorTopic) -> list[Finding]:
        """
        So sánh metric_field trong query results với day-of-week baseline.

        Với mỗi row:
          1. Đọc giá trị metric_field → upsert baseline sample
          2. So sánh với baseline_avg — nếu tăng > threshold_pct → Finding

        Chưa có baseline (tuần đầu chạy) → không tạo Finding, chỉ tích lũy data.
        """
        if not topic.baseline_config:
            return []

        config = topic.baseline_config
        now = now_vn()
        day_of_week = now.weekday()  # 0=Monday … 6=Sunday
        hour = now.hour

        findings: list[Finding] = []
        for result in results:
            if not result.success:
                continue
            for row in result.rows:
                raw = row.get(config.metric_field)
                if raw is None:
                    continue
                try:
                    value = float(raw)
                except (TypeError, ValueError):
                    logger.debug(
                        "baseline_detector: cannot convert field=%s value=%r to float (topic=%s)",
                        config.metric_field, raw, topic.topic_id,
                    )
                    continue

                # Tích lũy baseline data mỗi run — baseline sẽ đủ sau N tuần
                self._baseline_repo.upsert_baseline(
                    metric_type=topic.topic_id,
                    node=result.node,
                    day_of_week=day_of_week,
                    hour=hour,
                    new_sample={"value": value, "date": now.strftime("%Y-%m-%d")},
                    max_samples=config.baseline_weeks,
                )

                finding = self._compare_with_baseline(
                    value=value,
                    config=config,
                    topic=topic,
                    node=result.node,
                    role=result.role,
                    row=row,
                    day_of_week=day_of_week,
                    hour=hour,
                )
                if finding:
                    findings.append(finding)

        return findings

    def _compare_with_baseline(
        self,
        value: float,
        config: BaselineConfig,
        topic: MonitorTopic,
        node: str,
        role: str,
        row: dict,
        day_of_week: int,
        hour: int,
        query_hash: str | None = None,
    ) -> Finding | None:
        """So sánh 1 value với baseline. Trả về None nếu chưa đủ baseline data."""
        is_anomaly = self._baseline_repo.is_anomaly(
            metric_type=topic.topic_id,
            node=node,
            current_value=value,
            day_of_week=day_of_week,
            hour=hour,
            threshold_pct=config.threshold_pct,
            query_hash=query_hash,
        )
        if not is_anomaly:
            return None

        baseline_doc = self._baseline_repo.get_baseline(
            metric_type=topic.topic_id,
            node=node,
            day_of_week=day_of_week,
            hour=hour,
            query_hash=query_hash,
        )
        baseline_avg = baseline_doc["baseline_avg"] if baseline_doc else None

        # Include full row context để AI agent có đủ data
        metrics: dict = {
            config.metric_field: value,
            "baseline_avg": baseline_avg,
            "threshold_pct": config.threshold_pct,
        }
        for k, v in row.items():
            if k != config.metric_field and isinstance(v, (int, float, str, bool, type(None))):
                metrics[k] = v

        logger.debug(
            "baseline_detector: FINDING topic=%s field=%s value=%.2f baseline_avg=%s node=%s",
            topic.topic_id, config.metric_field, value, baseline_avg, node,
        )

        return Finding(
            topic_id=topic.topic_id,
            issue_type=IssueType.SLOW_QUERY,
            severity=Severity.WARNING,
            node=node,
            role=role,
            query_hash=query_hash,
            metrics=metrics,
        )
