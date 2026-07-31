FROM node:26-slim@sha256:715e55e4b84e4bb0ff48e49b398a848f08e55daed8eb6a0ea1839ae53bc57583

# node:26-slim ships npm 11.17.0, whose bundled node-tar (7.5.16) still carries
# CVE-2026-59873 (CRITICAL, gzip-bomb DoS) — this trips the image-security merge
# gate. npm 11.18.0 is the earliest maintained line bundling the patched tar
# 7.5.19; it is applied before `npm ci` so the build and the shipped image use
# the same npm (npm 11 needs Node >= 22.9, satisfied by the base). Revisit when a
# node:26-slim carrying fixed npm is published — see docs/DEPENDENCY-MAINTENANCE.md.
RUN npm install -g npm@11.18.0 && npm --version

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

# Non-root agent worker (#97). The control plane runs as root and, in the hardened
# profile, drops to this UID when it spawns the agent (Claude/Pi CLI) as a child
# process — so a worker shell cannot read the root control plane's /proc/1/environ
# or the root-owned /app/data/secrets.json. The Pi/Claude auth volumes are re-homed
# under /home/worker (see docker-compose.hardened.yml) and chowned to `worker` by
# the entrypoint on first hardened start. Harmless in the default local profile:
# the control plane stays root and never lowers a child, so the user is unused.
RUN groupadd --gid 10001 worker \
    && useradd --uid 10001 --gid 10001 --home-dir /home/worker --create-home --shell /usr/sbin/nologin worker \
    && mkdir -p /home/worker/.claude /home/worker/.pi \
    && chown -R worker:worker /home/worker

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
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.10 \
    && npm install -g @anthropic-ai/claude-code@2.1.220 \
    && claude --version

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Fail the build early if the Claude Agent SDK's arch-native CLI binary did not
# install (e.g. optional deps were dropped). This validates the BUILD arch; the
# entrypoint re-checks the RUN arch to catch a build-arch != run-arch mismatch.
RUN node scripts/check-claude-native.js --build

# excli is NOT redistributed in this repo (ExtraHop/agent-cli grants no
# redistribution rights). Fetch the arch-matched release from the pinned upstream
# source and verify it against the committed checksums at build time — see
# vendor/excli/source.env and scripts/fetch-excli.sh. Needs network + curl.
RUN set -eux; \
    chmod +x excli-interface start.sh scripts/*.sh; \
    bash scripts/fetch-excli.sh bin/excli; \
    ./bin/excli -version >/dev/null 2>&1 || ./bin/excli -help >/dev/null

EXPOSE 3100

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
