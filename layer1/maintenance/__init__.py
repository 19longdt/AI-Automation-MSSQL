"""
maintenance — Module xử lý maintenance index/statistics, chạy như PROCESS RIÊNG.

Entry: python -m layer1.maintenance.runner

Tách process khỏi monitoring (layer1.main) để có thể stop độc lập
(docker compose stop maintenance) khi treo/lag mà không mất giám sát.
Share codebase + MongoDB với layer1; KHÔNG poll Telegram getUpdates
(process monitoring giữ độc quyền poll — tránh conflict 409).
"""
