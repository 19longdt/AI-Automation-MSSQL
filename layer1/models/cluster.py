from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

EnvironmentType = Literal["production", "uat", "dev", "staging", "other"]


class ClusterNodeRole(BaseModel):
    """Runtime-detected role cho 1 node trong AG cluster.

    Được Layer 1 cập nhật sau mỗi lần role detection thành công.
    Lưu embedded trong db_clusters.node_roles để tất cả layers đọc được.
    """

    host: str
    server_name: str = ""
    role: str  # "primary" | "secondary"
    last_seen_at: datetime


class ClusterConfig(BaseModel):
    # max_length=12: derived from Telegram 64-byte callback_data limit.
    # Longest callback: "l1|mntb|" (8) + cluster_id + "|" (1) + UUID (36) + "|reject" (7) = 52 + len ≤ 64
    cluster_id: str = Field(..., min_length=1, max_length=12)
    name: str
    environment: EnvironmentType = "other"
    nodes: list[str]
    port: int = 1433
    database: str
    username: str
    password: str
    connect_timeout_sec: int = 30
    enabled: bool = True
    color: str = "#6b7280"
    node_roles: list[ClusterNodeRole] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("cluster_id", "name", "database", "username")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("field is required")
        return text

    @field_validator("nodes")
    @classmethod
    def validate_nodes(cls, value: list[str]) -> list[str]:
        cleaned = [node.strip() for node in value if node and node.strip()]
        if not cleaned:
            raise ValueError("nodes must not be empty")
        return cleaned

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        text = value.strip()
        if len(text) != 7 or not text.startswith("#"):
            raise ValueError("color must be in #RRGGBB format")
        return text.lower()

    def get_connection_string(self, host: str) -> str:
        return (
            f"DRIVER={{ODBC Driver 17 for SQL Server}};"
            f"SERVER={host},{self.port};"
            f"DATABASE={self.database};"
            f"UID={self.username};"
            f"PWD={self.password};"
            f"TrustServerCertificate=yes;"
            f"Connection Timeout={self.connect_timeout_sec};"
        )


class ClusterCreate(BaseModel):
    cluster_id: str = Field(..., min_length=1, max_length=12)  # same constraint as ClusterConfig
    name: str
    environment: EnvironmentType = "other"
    nodes: list[str]
    port: int = 1433
    database: str
    username: str
    password: str
    connect_timeout_sec: int = 30
    enabled: bool = True
    color: str = "#6b7280"


class ClusterUpdate(BaseModel):
    name: str | None = None
    environment: EnvironmentType | None = None
    nodes: list[str] | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: str | None = None
    connect_timeout_sec: int | None = None
    enabled: bool | None = None
    color: str | None = None


class ClusterResponse(BaseModel):
    cluster_id: str
    name: str
    environment: EnvironmentType
    nodes: list[str]
    port: int
    database: str
    username: str
    connect_timeout_sec: int
    enabled: bool
    color: str
    has_password: bool
    node_roles: list[ClusterNodeRole] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ClusterConnectionTestRequest(BaseModel):
    nodes: list[str]
    port: int = 1433
    database: str
    username: str
    password: str


class ClusterConnectionTestResponse(BaseModel):
    ok: bool
    latency_ms: float | None = None
    error: str | None = None
