# Alpha Tester Notes

- Run the app on localhost only. It has no built-in user authentication.
- Use dedicated, least-privilege ExtraHop API credentials for testing.
- Backend model/provider authentication is separate from ExtraHop credentials; complete Pi login/provider setup or Claude Code `/login` outside this repo as the same non-root user that runs `./start.sh`. Do not use `sudo` for startup.
- The package bundles the full ExtraHop CLI release under `vendor/excli/` (macOS and Linux archives for AMD64/ARM64, plus the Windows binary); `./start.sh` selects, checksum-verifies, and installs the right one automatically.
