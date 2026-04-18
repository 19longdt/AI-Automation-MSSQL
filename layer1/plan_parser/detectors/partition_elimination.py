"""
Phát hiện partition elimination failure — query scan toàn bộ partitions
thay vì chỉ partitions cần thiết.
"""
from __future__ import annotations


def detect_partition_elimination_failure(
    partitions_accessed: list[int],
    total_partitions: int,
) -> bool:
    """
    Trả về True nếu số partitions accessed = tổng partitions của bảng.
    total_partitions lấy từ sys.partitions — cần truyền vào từ collector.
    """
    ...
