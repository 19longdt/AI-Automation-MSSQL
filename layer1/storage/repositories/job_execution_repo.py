"""job_execution_repo.py — Tracking lịch sử mỗi lần job chạy."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from bson import ObjectId

from ..mongo_client import MongoConnection
from ...models.job import JobExecution, JobStatus

logger = logging.getLogger(__name__)

COLLECTION = "job_executions"


class JobExecutionRepo:

    @property
    def collection(self):
        return MongoConnection.get_db()[COLLECTION]

    def start(self, execution: JobExecution) -> str:
        """Insert record với status=RUNNING, trả về _id để update sau."""
        doc = execution.model_dump()
        result = self.collection.insert_one(doc)
        return str(result.inserted_id)

    def finish(
        self,
        doc_id: str,
        status: JobStatus,
        findings_created: int,
        error: str | None = None,
    ) -> None:
        """Update record khi job hoàn thành — set finished_at, duration_ms, status."""
        now = datetime.utcnow()
        doc = self.collection.find_one({"_id": ObjectId(doc_id)})
        duration_ms = 0.0
        if doc and doc.get("started_at"):
            duration_ms = (now - doc["started_at"]).total_seconds() * 1000

        update: dict = {
            "$set": {
                "finished_at": now,
                "status": status.value,
                "findings_created": findings_created,
                "duration_ms": duration_ms,
            }
        }
        if error is not None:
            update["$set"]["error_message"] = error

        self.collection.update_one({"_id": ObjectId(doc_id)}, update)

    def get_latest_per_job(self) -> list[dict]:
        """Trả về record mới nhất của mỗi job — dùng cho health dashboard."""
        pipeline = [
            {"$sort": {"started_at": -1}},
            {"$group": {"_id": "$job_name", "doc": {"$first": "$$ROOT"}}},
            {"$replaceRoot": {"newRoot": "$doc"}},
        ]
        return list(self.collection.aggregate(pipeline))

    def find_stuck_jobs(self, timeout_sec: int) -> list[dict]:
        """Tìm jobs có status=RUNNING và started_at quá lâu → stuck."""
        cutoff = datetime.utcnow() - timedelta(seconds=timeout_sec)
        return list(
            self.collection.find(
                {"status": JobStatus.RUNNING.value, "started_at": {"$lt": cutoff}}
            )
        )

    def find_missed_jobs(self, job_intervals: dict[str, int]) -> list[str]:
        """
        So sánh thời gian run cuối với interval expected.
        Trả về list job_name bị missed (chưa chạy đúng schedule).
        """
        now = datetime.utcnow()
        latest = {doc["job_name"]: doc for doc in self.get_latest_per_job()}
        missed: list[str] = []

        for job_name, interval_sec in job_intervals.items():
            doc = latest.get(job_name)
            if doc is None:
                # Chưa từng chạy
                missed.append(job_name)
                continue
            expected_by = doc["started_at"] + timedelta(seconds=interval_sec * 1.5)
            if now > expected_by:
                missed.append(job_name)

        return missed
