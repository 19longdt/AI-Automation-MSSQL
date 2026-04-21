"""
cost_calculator.py — Tính chi phí USD cho Claude API calls.

Pricing cập nhật theo Anthropic pricing page (USD per 1M tokens).
Khi Anthropic thay đổi giá → chỉ cần sửa MODEL_PRICING dict.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# USD per 1M tokens — cập nhật khi Anthropic thay đổi giá
# Nguồn: https://www.anthropic.com/pricing
MODEL_PRICING: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {
        "input":            3.00,
        "output":          15.00,
        "cache_read":       0.30,
        "cache_creation":   3.75,
    },
    "claude-haiku-4-5": {
        "input":            0.80,
        "output":           4.00,
        "cache_read":       0.08,
        "cache_creation":   1.00,
    },
    "claude-haiku-4-5-20251001": {
        "input":            0.80,
        "output":           4.00,
        "cache_read":       0.08,
        "cache_creation":   1.00,
    },
    "claude-opus-4-7": {
        "input":           15.00,
        "output":          75.00,
        "cache_read":       1.50,
        "cache_creation":  18.75,
    },
}

_TOKENS_PER_MILLION = 1_000_000


def calculate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> float:
    """
    Tính tổng chi phí USD cho 1 Claude API call.

    Args:
        model:                 Model ID, ví dụ: "claude-sonnet-4-6"
        input_tokens:          Input tokens chưa cache
        output_tokens:         Output tokens
        cache_read_tokens:     Tokens đọc từ prompt cache (rẻ hơn input)
        cache_creation_tokens: Tokens ghi vào prompt cache

    Returns:
        Chi phí USD, làm tròn 8 chữ số thập phân.
        Trả về 0.0 nếu model không có trong bảng giá.
    """
    pricing = MODEL_PRICING.get(model)
    if pricing is None:
        logger.warning("Model '%s' không có trong bảng giá — cost_usd = 0.0", model)
        return 0.0

    cost = (
        input_tokens          * pricing["input"]            / _TOKENS_PER_MILLION
        + output_tokens       * pricing["output"]           / _TOKENS_PER_MILLION
        + cache_read_tokens   * pricing["cache_read"]       / _TOKENS_PER_MILLION
        + cache_creation_tokens * pricing["cache_creation"] / _TOKENS_PER_MILLION
    )
    return round(cost, 8)


def format_cost(cost_usd: float) -> str:
    """Format cost để hiển thị trong Telegram message."""
    if cost_usd < 0.001:
        return f"${cost_usd:.6f}"
    return f"${cost_usd:.4f}"
