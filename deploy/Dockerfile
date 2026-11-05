# Build the modified backend for the container's Linux architecture. The
# `aioncore` named context is supplied by compose.docker.yml.
FROM oven/bun:1 AS aioncore-build
# Install the toolchain before COPY so source edits do not invalidate this layer.
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
       curl ca-certificates build-essential cmake git libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && curl --retry 5 --retry-all-errors --retry-delay 2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.95.0
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /src/aioncore
COPY --from=aioncore . .
RUN cargo build --locked --release --package aionui-app --bin aioncore --features weixin

# Build the AionUi renderer and its standalone WebUI launcher.
FROM oven/bun:1 AS web-build
WORKDIR /src/aionui
COPY package.json bun.lock ./
COPY patches/ ./patches/
COPY packages/desktop/package.json ./packages/desktop/package.json
COPY packages/shared-scripts/package.json ./packages/shared-scripts/package.json
COPY packages/web-cli/package.json ./packages/web-cli/package.json
COPY packages/web-host/package.json ./packages/web-host/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run package
RUN mkdir -p /out/static \
    && bun build --compile --target=bun-linux-x64 --outfile=/out/aionui-web packages/web-cli/src/index.ts \
    && cp package.json /out/package.json \
    && cp -R out/renderer/. /out/static/

# Runtime contains the server CLI, custom AionCore binary, and tools commonly
# used by AionCore agents to create or inspect Office documents.
FROM oven/bun:1 AS runtime
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl git libicu-dev nodejs npm \
       python3 python3-docx python3-openpyxl python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/aionui-venv \
    && /opt/aionui-venv/bin/pip install --no-cache-dir \
       -i https://pypi.tuna.tsinghua.edu.cn/simple python-pptx \
    && groupadd --system aionui \
    && useradd --system --gid aionui --create-home --home-dir /home/aionui --shell /usr/sbin/nologin aionui \
    && mkdir -p /app /data \
    && chown -R aionui:aionui /app /data /home/aionui

WORKDIR /app
COPY --from=web-build --chown=aionui:aionui /out/aionui-web ./aionui-web
COPY --from=web-build --chown=aionui:aionui /out/package.json ./package.json
COPY --from=web-build --chown=aionui:aionui /out/static ./static
COPY --from=aioncore-build --chown=aionui:aionui /src/aioncore/target/release/aioncore ./bundled-aioncore/linux-x64/aioncore

ENV NODE_ENV=production \
    PATH=/opt/aionui-venv/bin:${PATH} \
    AIONUI_ALLOW_REMOTE=true \
    AIONUI_DATA_DIR=/data \
    AIONUI_LOG_DIR=/data/logs \
    AIONUI_BACKEND_BIN=/app/bundled-aioncore/linux-x64/aioncore \
    AIONUI_OPEN_BROWSER=false

VOLUME ["/data"]
EXPOSE 25808
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:25808/api/auth/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER aionui
CMD ["/app/aionui-web", "start", "--remote", "--port", "25808", "--data-dir", "/data", "--no-open"]
