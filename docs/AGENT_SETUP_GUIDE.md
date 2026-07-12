# Deployment Guide for Agents

You are helping a user stand up the ExtraHop Investigation Agent web tool from this package.

## What This Tool Is

This is a local web UI for an autonomous ExtraHop investigation agent. The Node.js server starts the Pi coding agent in RPC mode, gives it a project-local `./excli-interface` broker interface for the ExtraHop CLI, and exposes a browser chat UI with workspace file viewing, uploads, streaming tool activity, and HTML investigation reports.

The package contains the web UI, skills, report templates, workspace layout conventions, Node lockfile, top-level launcher, bootstrap script, repository-root `./excli-interface` interface, and the bundled ExtraHop CLI release under `vendor/excli/` (**macOS and Linux archives for AMD64 and ARM64**, the **Windows AMD64 binary**, and the release's sha256 checksums). The bootstrap script detects the host OS/CPU, verifies the matching archive against the checksums, and installs its binary as `bin/excli`; no manual binary selection or chmod is needed on macOS or Linux. The major thing the user must provide separately is the Pi agent harness plus Pi authentication to at least one inference provider.

## Requirements

1. **Pi coding agent installed and authenticated**
   - Website: <https://pi.dev>
   - npm install option:
     ```bash
     npm install -g --ignore-scripts @earendil-works/pi-coding-agent
     ```
   - installer option:
     ```bash
     curl -fsSL https://pi.dev/install.sh | sh
     ```
   - On Windows, direct the user to the PowerShell installer shown at <https://pi.dev> or use WSL.
   - After installing Pi, the user should open a new terminal so `pi` is on `PATH`.

2. **Pi connected to an inference provider**
   - Launch Pi interactively:
     ```bash
     pi
     ```
   - In Pi, run:
     ```text
     /login
     ```
   - The user can choose a subscription provider or API-key provider. Pi supports many providers including Anthropic Claude, OpenAI/Codex, Gemini, GitHub Copilot, OpenRouter, Bedrock, Vertex, and others.
   - For an Enterprise Claude/Anthropic subscription flow, use:
     ```text
     /login > Subscription > Anthropic
     ```
   - After login, have the user test Pi with a simple prompt like `hello` or `ping`.
   - The web UI launcher does not create Pi provider accounts, store Pi provider
     credentials, or complete browser/OAuth flows. Let the operator complete
     those flows interactively in Pi.

3. **Node.js 20+ and npm**
   - The bootstrap script checks this. If missing, install Node.js 20+ before continuing.

4. **ExtraHop CLI (`excli`)**
   - This package bundles the full `excli` release under `vendor/excli/` (macOS/Linux archives for AMD64 and ARM64 plus the Windows binary) and the repository-root `./excli-interface` broker interface. Bootstrap picks the archive matching the host, verifies its checksum, and installs its binary as `bin/excli` automatically.
   - Only if no bundled archive matches the host, ask the user to download the correct `excli` from <https://customer.extrahop.com> in the ExtraHop User Forums, **Agentic Ops** group, and pass it via `EXCLI_PATH`, `EXCLI_ARCHIVE`, or `EXCLI_URL`.
   - Do not guess at a replacement binary. Get the correct OS/architecture asset from the user.
   - For routine binary replacement, use [EXCLI_MAINTENANCE.md](EXCLI_MAINTENANCE.md).

5. **tshark / Wireshark CLI recommended**
   - `tshark` is not bundled, but it is very useful when the agent downloads PCAPs from ExtraHop.
   - The bootstrap script checks for it and can help install it.
   - Install hints:
     ```bash
     brew install wireshark              # macOS
     sudo apt-get install tshark         # Debian/Ubuntu
     sudo dnf install wireshark-cli      # Fedora/RHEL-like
     ```

6. **ExtraHop credentials**
   - Do not ask the user to paste ExtraHop credentials into this repository or commit them.
   - The user can enter ExtraHop host/API credentials after launch using the web UI cog in the lower-left corner.
   - Alternatively, a local `.env` can be created from `.env.example`, but UI settings are preferred for normal users.
   - ExtraHop credentials belong in the app settings or local `.env`, not in Pi
     provider configuration. The Pi process should call `./excli-interface`; it should not
     receive raw `EXTRAHOP_*` secrets.

## Deployment Steps

If the user downloaded a zip package, deploy it in a clean folder.

1. **Unzip and enter the package directory**
   ```bash
   unzip eh-investigator-agent-webui.zip
   cd eh-investigator-agent-webui
   ```

2. **Confirm Pi works from this terminal**
   ```bash
   pi --version
   pi --list-models
   ```
   If either command fails because Pi is missing or unauthenticated, pause deployment and guide the user through Pi install/login above.

3. **Confirm the excli interface and bundled release are present**
   ```bash
   ls -l ./excli-interface ./vendor/excli/
   ```

   `bin/excli` does not need to exist yet; bootstrap selects the `vendor/excli/` archive that matches the host, verifies it against the bundled checksums file, installs its binary as `bin/excli`, and fixes execute permissions automatically. It also replaces a wrong-platform `bin/excli` left over from another machine.

   On macOS, browser-downloaded zip files can cause Gatekeeper to block bundled command-line binaries with messages like "cannot be opened," "developer cannot be verified," or "move to Trash." Bootstrap clears the quarantine attribute when possible. If the user still gets a macOS security prompt, tell them to open **System Settings -> Privacy & Security** and allow/open the blocked `excli`, then retry `./bin/excli -help`.

   If no bundled binary matches the host OS/CPU, ask the user for the platform-appropriate ExtraHop CLI release asset from <https://customer.extrahop.com> -> ExtraHop User Forums -> **Agentic Ops** group. Then run bootstrap with one of:
   ```bash
   EXCLI_PATH=/absolute/path/to/excli ./start.sh
   EXCLI_ARCHIVE=/absolute/path/to/excli-<os>-<arch>.tar.gz ./start.sh
   EXCLI_URL=https://.../excli-<os>-<arch>.tar.gz ./start.sh
   ```
   For an already-installed package, use `./scripts/update-excli.sh /path/to/excli-or-archive` to replace only `bin/excli`.

4. **Check for tshark**
   ```bash
   command -v tshark && tshark -v | head -1
   ```
   If missing, recommend installing it now or offer to do it. PCAP workflows still run without tshark, but packet analysis is much better with it.

5. **Start the app**
   ```bash
   ./start.sh
   ```
   If `start.sh` lost its execute bit in transit (common after zip round-trips or Windows-mounted filesystems), run `bash ./start.sh` once; setup restores the permissions from there.

   The launcher delegates to bootstrap with `--start`. It repairs execute permissions, installs Node dependencies, verifies Pi, `./excli-interface`, and `bin/excli` (installing the bundled binary for the detected OS/CPU when needed), clears macOS quarantine from `bin/excli` when possible, checks for tshark, optionally prompts for local ExtraHop credentials, runs syntax checks, and starts the server bound to localhost.

   To ask bootstrap to install tshark automatically if possible:
   ```bash
   ./start.sh --with-tshark
   ```

6. **Open the web UI**
   - Default URL: <http://127.0.0.1:3100>
   - Health check: <http://127.0.0.1:3100/api/health>

7. **Configure ExtraHop**
   - In the web UI, click the cog in the lower-left corner.
   - Enter the ExtraHop host and either RevealX Enterprise API key or RevealX 360 client credentials.
   - Save settings, then start a new session.

## If Deploying Manually Instead of Bootstrap

Use these commands from the package root (pick the `vendor/excli` archive that matches the host):

```bash
tar -xzf ./vendor/excli/excli-<os>-<arch>-*.tar.gz -C /tmp excli
mv /tmp/excli ./bin/excli
chmod +x ./bin/excli ./excli-interface
xattr -dr com.apple.quarantine ./bin/excli 2>/dev/null || true  # macOS only
npm ci --omit=dev
npm run check
npm start
```

Then open <http://127.0.0.1:3100>.

## Important Safety Rules

- Keep this tool bound to localhost unless the user deliberately adds authentication and network hardening.

## Troubleshooting

- **`pi: command not found`**: Install Pi from <https://pi.dev>, then open a new terminal.
- **`pi --list-models` fails**: Pi is installed but not authenticated/configured. Run `pi`, then `/login`.
- **Server starts but agent calls fail**: Confirm the Node process can find `pi` on `PATH`; restart the terminal after installing Pi.
- **macOS blocks `bin/excli`**: Run `xattr -dr com.apple.quarantine ./bin/excli`, then retry. If needed, allow it in System Settings -> Privacy & Security.
- **`bin/excli` missing or wrong platform**: Rerun `./start.sh`; it installs or replaces `bin/excli` from the bundled `vendor/excli/` release archives. If no bundled archive matches the host, ask the user for the correct ExtraHop CLI binary/archive from <https://customer.extrahop.com> -> ExtraHop User Forums -> Agentic Ops group, then run `./scripts/update-excli.sh /path/to/excli-or-archive`.
- **`./start.sh: Permission denied`**: Run `bash ./start.sh` once; bootstrap restores the execute bits on the launcher, scripts, and binaries.
- **`tshark` missing**: Recommend installing Wireshark/tshark. It is especially useful for PCAPs downloaded from ExtraHop.
- **Port already in use**: Start on another port:
  ```bash
  PORT=3200 npm start
  ```
- **PDF export unavailable**: Optional only. Run:
  ```bash
  ./scripts/bootstrap.sh --with-pdf
  ```
