FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100 \
    # Claude Code backend: the app drives Claude Code in bypassPermissions mode,
    # which Claude Code refuses to run as root unless IS_SANDBOX=1 signals a
    # contained environment (verified: clears the root guard). CLAUDE_CONFIG_DIR
    # consolidates all Claude state (config + OAuth credentials + sessions) into
    # one directory so a single mounted volume persists the login.
    IS_SANDBOX=1 \
    CLAUDE_CONFIG_DIR=/root/.claude

WORKDIR /app

# tshark: recommended for parsing PCAPs downloaded from ExtraHop (not used for
# live capture, so no setuid/cap_net_raw grant is needed).
# ca-certificates/curl/tar: HTTPS + archive handling.
# weasyprint: Debian package bundles Cairo/Pango/etc., so HTML report PDF
# export works out of the box (pdf-export.js falls back to `weasyprint` on PATH).
# NOTE: the Wireshark GUI is intentionally omitted — the "Open in Wireshark"
# feature launches a desktop app and is meaningless in a headless container;
# its preflight check is optional and will simply report unavailable.
RUN echo "wireshark-common wireshark-common/install-setuid boolean false" | debconf-set-selections \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates curl tar tshark weasyprint jq \
    && rm -rf /var/lib/apt/lists/*

# Both backends are installed so either can be selected in Settings:
#   - Pi           (@earendil-works/pi-coding-agent, provides the `pi` CLI)
#   - Claude Code  (@anthropic-ai/claude-code, provides the `claude` CLI; the
#                   app runs it via @anthropic-ai/claude-agent-sdk from deps)
# Provider auth for each is per-user and NOT baked into the image — it lives in
# the mounted volumes (~/.pi and ~/.claude). Log in once per backend you use:
#   docker compose run --rm -it eh-investigator pi        (then /login)
#   docker compose run --rm -it eh-investigator claude    (then /login)
# Node 22.19+ is required for current Pi releases.
# Pi installs cleanly with --ignore-scripts. Claude Code must run its
# postinstall to fetch its platform-native binary, so install it separately
# without --ignore-scripts.
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
    && npm install -g @anthropic-ai/claude-code \
    && claude --version

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# excli: this release bundles every platform's CLI under vendor/excli/ with a
# checksums file. Instead of the old macOS->Linux binary swap, extract the
# archive matching THIS image's architecture into bin/excli at build time.
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      aarch64|arm64) exarch=arm64 ;; \
      x86_64|amd64)  exarch=amd64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    archive="$(ls vendor/excli/excli-linux-${exarch}-*.tar.gz | head -n1)"; \
    mkdir -p bin; \
    tar -xzf "$archive" -C /tmp; \
    cp "$(find /tmp -type f -name excli -perm -111 -print -quit)" bin/excli; \
    chmod 0755 bin/excli; \
    chmod +x excli-interface start.sh scripts/*.sh; \
    ./bin/excli -version >/dev/null 2>&1 || ./bin/excli -help >/dev/null

EXPOSE 3100

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
