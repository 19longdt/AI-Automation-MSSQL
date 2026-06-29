from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from ..infra.time_utils import now_vn


class CatalogScopeSchema(BaseModel):
    name: str | None = None
    schema_name: str
    table_names: list[str] = Field(default_factory=list)

    @field_validator("schema_name")
    @classmethod
    def validate_schema_name(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("schema_name cannot be empty")
        return text

    @field_validator("table_names")
    @classmethod
    def normalize_table_names(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item.strip()]


class CatalogScopeDatabase(BaseModel):
    database_name: str
    schemas: list[CatalogScopeSchema] = Field(min_length=1)

    @field_validator("database_name")
    @classmethod
    def validate_database_name(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("database_name cannot be empty")
        return text



class CatalogConfig(BaseModel):
    cluster_id: str
    databases: list[CatalogScopeDatabase] = Field(default_factory=list)
    enabled: bool = True
    updated_at: datetime = Field(default_factory=now_vn)


class CatalogIndexPartition(BaseModel):
    partition_number: int
    fragmentation_pct: float | None = None
    page_count: int | None = None


class CatalogIndexEntry(BaseModel):
    index_id: int
    index_name: str | None = None
    index_type: str
    is_unique: bool = False
    is_partitioned: bool = False
    fragmentation_pct: float | None = None
    page_count: int | None = None
    partition_count: int = 1
    partitions: list[CatalogIndexPartition] = Field(default_factory=list)


class CatalogStatsEntry(BaseModel):
    stats_id: int
    stats_name: str
    last_updated: datetime | None = None
    rows: int = 0
    rows_sampled: int = 0
    modification_counter: int = 0
    auto_created: bool = False


class CatalogTableDocument(BaseModel):
    cluster_id: str
    database_name: str
    run_id: str
    schema_name: str
    table_name: str
    object_id: int
    row_count: int = 0
    reserved_kb: int = 0
    data_kb: int = 0
    index_kb: int = 0
    indexes: list[CatalogIndexEntry] = Field(default_factory=list)
    statistics: list[CatalogStatsEntry] = Field(default_factory=list)
    heap_forwarded_count: int | None = None
    captured_at: datetime = Field(default_factory=now_vn)
