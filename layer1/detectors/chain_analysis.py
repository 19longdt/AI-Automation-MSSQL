"""
chain_analysis.py — Pure functions phân tích blocking chain graph.

Tách khỏi blocking_detector.py để:
  - Test độc lập không cần MSSQL/MonitorTopic (logic graph thuần)
  - Tái sử dụng được trong capture handlers nếu cần

Input là rows từ query `blocking_sessions` (sys.dm_exec_requests):
mỗi row có `session_id` (victim) và `blocking_session_id` (blocker trực tiếp).

Lưu ý về cycle: snapshot DMV có thể chứa cycle (A block B, B block A —
deadlock đang trong quá trình resolve, hoặc snapshot không atomic).
Mọi hàm walk graph đều dùng visited-set để không loop vô hạn;
cycle component lấy min(session_id) làm pseudo-head để finding vẫn tạo được.
"""
from __future__ import annotations


def build_chain(rows: list[dict]) -> dict[int, int]:
    """
    Build blocking graph từ rows: {blocked_session_id: blocking_session_id}.

    Skip row thiếu/sai kiểu session ids và self-blocking
    (blocking_session_id == session_id — artifact của latch waits).
    """
    chain: dict[int, int] = {}
    for row in rows:
        session_id = row.get("session_id")
        blocking_id = row.get("blocking_session_id")
        if not isinstance(session_id, int) or not isinstance(blocking_id, int):
            continue
        if blocking_id <= 0 or blocking_id == session_id:
            continue
        chain[session_id] = blocking_id
    return chain


def resolve_head_blocker(chain: dict[int, int], session_id: int) -> int:
    """
    Walk ngược từ 1 session lên đến head blocker (session không bị block bởi ai).

    Nếu gặp cycle → trả min(session_id) trong cycle làm pseudo-head
    (deterministic — mọi victim trong cùng cycle resolve về cùng 1 head).
    """
    visited: list[int] = []
    current = session_id
    while current in chain:
        if current in visited:
            # Cycle: phần đường đi từ lần gặp đầu của `current` là cycle members
            cycle = visited[visited.index(current):]
            return min(cycle)
        visited.append(current)
        current = chain[current]
    return current


def find_head_blockers(chain: dict[int, int]) -> set[int]:
    """Tập các head blocker — resolve từ mọi victim trong graph."""
    return {resolve_head_blocker(chain, victim) for victim in chain}


def group_victims_by_head(chain: dict[int, int]) -> dict[int, list[int]]:
    """
    Gom victims theo head blocker: {head_session_id: [victim_session_id, ...]}.

    Head blocker là trung tâm của finding (scope: session GÂY RA blocking) —
    1 head = 1 incident, victims chỉ là detail.
    """
    groups: dict[int, list[int]] = {}
    for victim in chain:
        head = resolve_head_blocker(chain, victim)
        if victim == head:
            # Pseudo-head của cycle cũng là victim — không tự liệt kê mình
            continue
        groups.setdefault(head, []).append(victim)
    return groups


def chain_depth_for_head(chain: dict[int, int], head: int) -> int:
    """
    Max số bước (edges) từ victim xa nhất lên head.

    Ví dụ: A block B, B block C → depth của A = 2.
    Depth 1 (A block B) là phổ biến và thường tự resolve;
    depth 3+ mới là dấu hiệu long transaction (threshold trong topic config).
    """
    max_depth = 0
    for victim in chain:
        depth = 0
        visited: set[int] = set()
        current = victim
        while current in chain and current not in visited:
            visited.add(current)
            current = chain[current]
            depth += 1
            if current == head:
                max_depth = max(max_depth, depth)
                break
        # Cycle pseudo-head: walk dừng do visited — depth tính đến điểm dừng
        if current != head and resolve_head_blocker(chain, victim) == head:
            max_depth = max(max_depth, depth)
    return max_depth
