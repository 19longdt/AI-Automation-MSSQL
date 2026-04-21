from __future__ import annotations

from fastapi import APIRouter, Request

from ...executor.mssql_connection import test_connection
from ...storage.mongo_client import MongoConnection

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(request: Request) -> dict:
    """Health check: MongoDB ping + MSSQL reachability per node."""
    nrc = request.app.state.node_role_cache
    mongo_ok = MongoConnection.ping()

    import asyncio, concurrent.futures
    loop = asyncio.get_event_loop()
    hosts = nrc.get_all_hosts()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        results = await asyncio.gather(
            *[loop.run_in_executor(pool, test_connection, h) for h in hosts]
        )
    nodes = {h: ok for h, ok in zip(hosts, results)}

    all_ok = mongo_ok and all(nodes.values())
    return {
        "status": "ok" if all_ok else "degraded",
        "mongodb": mongo_ok,
        "mssql_nodes": nodes,
        "primary": nrc.get_primary_host(),
    }
