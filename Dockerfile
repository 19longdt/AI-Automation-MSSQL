# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — MSSQL Monitoring Service
#
# Base image: python:3.11-slim-bullseye (Debian 11)
# Dùng Debian 11 thay vì 12 vì ODBC Driver 17 chưa có gói chính thức cho Debian 12.
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim-bullseye

# Install system deps:
#   curl, gnupg2, apt-transport-https — cần để thêm Microsoft repo
#   unixodbc-dev                      — cần để build pyodbc
#   msodbcsql17                       — ODBC Driver 17 for SQL Server
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        gnupg2 \
        apt-transport-https \
        unixodbc-dev \
    && curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add - \
    && curl https://packages.microsoft.com/config/debian/11/prod.list \
        > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql17 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài Python dependencies trước khi copy source — tận dụng Docker layer cache.
# Nếu requirements.txt không đổi thì bước này được cache, build nhanh hơn.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY layer1/ ./layer1/

# Chạy bằng non-root user để giảm attack surface.
# /var/lib/layer1/logstash là persistent queue path cho python-logstash-async
# (được mount qua volume trong docker-compose.yml).
RUN useradd -m -u 1000 monitor \
    && mkdir -p /var/lib/layer1/logstash \
    && chown -R monitor:monitor /app /var/lib/layer1
USER monitor

CMD ["python", "-m", "layer1.scheduler"]
