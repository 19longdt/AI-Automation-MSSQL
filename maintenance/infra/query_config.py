from pydantic import BaseModel, Field


class QueryConfig(BaseModel):
    query_id: str
    description: str = ""
    sql: str
    timeout_sec: int = Field(default=30, ge=1)
