"""
main.py — FastAPI entry point cho Layer 2 AI Analysis Agent.

Startup sequence:
  1. Setup logging
  2. MongoConnection.initialize()
  3. create_all_indexes()
  4. SkillLoader.load_all()       ← fail fast nếu _base.yaml thiếu
  5. NodeRoleCache.initialize()   ← fail fast nếu cluster unreachable
  6. TelegramBot.start()          ← daemon thread (nếu token có)
  7. Background task: NodeRoleCache.refresh() theo interval
  8. uvicorn serve

Chạy: python -m layer2.main
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from .agent.context_builder import ContextBuilder
from .agent.orchestrator import AgentOrchestrator
from .agent.skill_loader import SkillLoader
from .agent.tool_executor import ToolExecutor
from .api.routes import admin, analysis, health, insights, skills
from .config import settings
from .executor.node_role_cache import NodeRoleCache
from .storage.indexes import create_all_indexes
from .storage.mongo_client import MongoConnection
from .storage.repositories.db_context_repo import DbContextRepo

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).parent / "skills"


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _setup_logging()

    MongoConnection.initialize(settings)
    create_all_indexes(MongoConnection.get_db())

    sl = SkillLoader()
    sl.load_all(SKILLS_DIR)

    nrc = NodeRoleCache()
    nrc.initialize()

    db_context_repo = DbContextRepo()
    ctx_builder = ContextBuilder(sl, db_context_repo)
    tool_exec = ToolExecutor(nrc, settings.peak_hours_start, settings.peak_hours_end)
    orch = AgentOrchestrator(sl, ctx_builder, tool_exec)

    # Routes truy cập qua request.app.state
    app.state.skill_loader = sl
    app.state.node_role_cache = nrc
    app.state.orchestrator = orch
    app.state.db_context_repo = db_context_repo

    _start_telegram_bot(orch, sl, nrc)

    refresh_task = asyncio.create_task(_node_role_refresh_loop(nrc))

    logger.info(
        "Layer 2 started. skills=%d nodes=%s",
        len(sl.list_skills()),
        nrc.get_all_hosts(),
    )

    yield

    refresh_task.cancel()
    MongoConnection.close()
    logger.info("Layer 2 shutdown.")


def _start_telegram_bot(
    orch: AgentOrchestrator,
    sl: SkillLoader,
    nrc: NodeRoleCache,
) -> None:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        logger.info("TelegramBot: skip (TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID chưa set).")
        return
    from .notifications.telegram_bot import TelegramBot
    bot = TelegramBot(settings.telegram_bot_token, settings.telegram_chat_id, orch)
    bot.start()
    logger.info("TelegramBot started.")
    bot.send_startup(
        skills=sl.list_skills(),
        primary=nrc.get_primary_host(),
        secondaries=nrc.get_secondary_hosts(),
        model=settings.claude_model,
        timeout_sec=settings.agent_timeout_sec,
        peak_start=settings.peak_hours_start,
        peak_end=settings.peak_hours_end,
    )


async def _node_role_refresh_loop(nrc: NodeRoleCache) -> None:
    while True:
        await asyncio.sleep(settings.node_role_refresh_sec)
        try:
            await asyncio.get_event_loop().run_in_executor(None, nrc.refresh)
        except Exception as exc:
            logger.warning("NodeRoleCache refresh failed: %s", exc)


def _setup_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("anthropic").setLevel(logging.WARNING)

    if not settings.logstash_host:
        return

    # Optional dependency — chỉ import khi LOGSTASH_HOST có set.
    try:
        from logstash_async.handler import AsynchronousLogstashHandler
        from logstash_async.formatter import LogstashFormatter
    except ImportError:
        logging.getLogger().error(
            "LOGSTASH_HOST configured but python-logstash-async not installed; skipping."
        )
        return

    import socket as _socket

    # UDP transport — tương thích Logstash input: udp { port => 5044 codec => json }
    handler = AsynchronousLogstashHandler(
        host=settings.logstash_host,
        port=settings.logstash_port,
        database_path=settings.logstash_database_path or None,
        transport="logstash_async.transport.UdpTransport",
    )
    # extra_prefix=None: extra fields ở top-level — Logstash filter check [app_name] top-level.
    handler.setFormatter(LogstashFormatter(
        extra_prefix=None,
        extra={
            "app_name": settings.logstash_app_name,
            "service": "layer2-agent",
            "hostname": _socket.gethostname(),
        },
    ))
    logging.getLogger().addHandler(handler)
    logging.getLogger().info(
        "Logstash handler attached: %s:%s app_name=%s database_path=%s",
        settings.logstash_host,
        settings.logstash_port,
        settings.logstash_app_name,
        settings.logstash_database_path or "<in-memory>",
    )


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Layer 2 — AI Analysis Agent",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(analysis.router)
app.include_router(insights.router)
app.include_router(skills.router)
app.include_router(admin.router)


if __name__ == "__main__":
    uvicorn.run("layer2.main:app", host="0.0.0.0", port=8000, reload=False, log_config=None)
