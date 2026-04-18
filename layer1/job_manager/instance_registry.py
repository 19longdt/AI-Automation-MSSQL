"""instance_registry.py — Định danh duy nhất cho mỗi service instance."""
from __future__ import annotations

import os
import socket


def get_instance_id() -> str:
    """
    Tạo instance ID dạng 'hostname:pid'.
    hostname + pid đảm bảo unique ngay cả khi nhiều instances
    chạy trên cùng 1 máy (khác nhau về PID).
    """
    ...


def get_hostname() -> str: ...
