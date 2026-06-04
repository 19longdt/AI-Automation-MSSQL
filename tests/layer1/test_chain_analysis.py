"""Unit tests cho layer1.detectors.chain_analysis — pure graph logic."""
from __future__ import annotations

from layer1.detectors.chain_analysis import (
    build_chain,
    chain_depth_for_head,
    find_head_blockers,
    group_victims_by_head,
    resolve_head_blocker,
)


def _rows(*pairs: tuple[int, int]) -> list[dict]:
    """(victim, blocker) pairs → DMV-style rows."""
    return [{"session_id": v, "blocking_session_id": b} for v, b in pairs]


class TestBuildChain:
    def test_simple_chain(self):
        chain = build_chain(_rows((200, 100), (300, 200)))
        assert chain == {200: 100, 300: 200}

    def test_skips_self_blocking(self):
        # blocking_session_id == session_id là artifact của latch waits
        assert build_chain(_rows((5, 5))) == {}

    def test_skips_invalid_rows(self):
        rows = [
            {"session_id": None, "blocking_session_id": 3},
            {"session_id": "abc", "blocking_session_id": 3},
            {"session_id": 7, "blocking_session_id": 0},
            {"unrelated": 1},
        ]
        assert build_chain(rows) == {}

    def test_empty(self):
        assert build_chain([]) == {}


class TestResolveHeadBlocker:
    def test_walks_to_head(self):
        chain = {200: 100, 300: 200}
        assert resolve_head_blocker(chain, 300) == 100
        assert resolve_head_blocker(chain, 200) == 100

    def test_unblocked_session_is_its_own_head(self):
        assert resolve_head_blocker({}, 42) == 42

    def test_cycle_resolves_to_min_sid(self):
        # A block B, B block A — pseudo-head deterministic = min(cycle)
        chain = {10: 20, 20: 10}
        assert resolve_head_blocker(chain, 10) == 10
        assert resolve_head_blocker(chain, 20) == 10

    def test_tail_leading_into_cycle(self):
        # 30 → 20 → 10 → 20 (cycle 10↔20, tail từ 30)
        chain = {30: 20, 20: 10, 10: 20}
        assert resolve_head_blocker(chain, 30) == 10


class TestGroupVictims:
    def test_single_head_multiple_victims(self):
        chain = build_chain(_rows((200, 100), (300, 100), (400, 200)))
        assert group_victims_by_head(chain) == {100: [200, 300, 400]}

    def test_multiple_independent_chains(self):
        chain = build_chain(_rows((200, 100), (500, 400)))
        groups = group_victims_by_head(chain)
        assert groups == {100: [200], 400: [500]}

    def test_find_head_blockers(self):
        chain = build_chain(_rows((200, 100), (300, 200), (500, 400)))
        assert find_head_blockers(chain) == {100, 400}


class TestChainDepth:
    def test_depth_one(self):
        chain = build_chain(_rows((200, 100)))
        assert chain_depth_for_head(chain, 100) == 1

    def test_depth_linear(self):
        # 100 ← 200 ← 300 ← 400: depth = 3
        chain = build_chain(_rows((200, 100), (300, 200), (400, 300)))
        assert chain_depth_for_head(chain, 100) == 3

    def test_depth_fan_out(self):
        # 100 block trực tiếp 3 victims → depth vẫn = 1
        chain = build_chain(_rows((200, 100), (300, 100), (400, 100)))
        assert chain_depth_for_head(chain, 100) == 1

    def test_depth_with_cycle(self):
        # Cycle 10↔20, tail 30 → 20: không loop vô hạn
        chain = {30: 20, 20: 10, 10: 20}
        depth = chain_depth_for_head(chain, 10)
        assert depth >= 1  # terminates, depth dương
