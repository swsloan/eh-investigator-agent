# Security policy

## Supported versions

Security fixes are developed against the latest commit on `main` and the most
recent tagged release. Older commits and locally modified deployments may be
asked to reproduce an issue on a supported version before a fix is prepared.

## Reporting a vulnerability

Report suspected vulnerabilities through the repository's private
[GitHub security advisory](https://github.com/swsloan/eh-investigator-agent/security/advisories/new).
Do not open a public issue for credentials, customer traffic, investigation
evidence, exploitable details, or an unpatched vulnerability.

Include only the minimum sanitized information needed to reproduce the issue:

- affected version or commit;
- deployment profile and platform;
- affected component and security boundary;
- reproducible steps or a proof of concept without real credentials/data;
- expected impact and any known workaround.

The maintainer will acknowledge the report, coordinate validation and a fix,
and decide when disclosure is safe. No fixed response or remediation deadline
is promised by this community repository.

## Deployment boundary

The default Docker Compose deployment is intentionally published on host
loopback and has no user authentication. Do not expose it to another host or an
untrusted container network. Use the hardened token profile described in
[`docs/SECURITY-HARDENING.md`](docs/SECURITY-HARDENING.md) whenever the local
single-host trust assumption does not apply.
