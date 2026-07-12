# eval/cases — labeled ground-truth cases

The real, environment-derived case set the eval harness scores against
(`cases.schema.json` defines the shape). Synthetic cases used only for
harness demos/tests live in [`../harness/example-cases`](../harness/example-cases),
not here.

## Provenance tiers

Each case's `notes` records the basis for its `expected` label. Two tiers:

- **Adjudicated** — investigated end-to-end via the evidence-ladder against the
  live environment.
  - `lamehug-hf-c2` — **malicious.** IDS PowerShell-stager signature that a naive
    triage would dismiss as a huggingface.co false positive; records revealed the
    true offender (172.16.204.153, behind the proxy) polling the HF Qwen2.5-Coder
    inference API with a `LameHug-Sim` user-agent and receiving
    `application/x-powershell` payloads — an LLM-as-C2 channel. This is also the
    Phase-1 skill validation artifact (see docs/DESIGN-evidence-ladder.md).
- **Seed** — label inferred from detection semantics (category, type, participants,
  destination) and **pending analyst sign-off**. Marked "SEED" in `notes`:
  `ms-telemetry-fp`, `ssdp-dlink-fp` (false-positive); `unknown-public-dns`,
  `smbv1-dc`, `plaintext-http-creds` (benign hygiene).

Before these gate anything, an analyst should confirm each seed label by running
the case (the point of the eval is to *measure* against trusted ground truth, so
the ground truth must itself be trustworthy).

## Coverage

1 malicious, 2 false-positive, 3 benign — spanning IDS and hardening sources.
Gaps to fill as the set grows: a confirmed `benign-authorized` (authorized
scanner), more `malicious` cases, and ambiguous cases (e.g. the WinRM-UA
lateral-movement detection) that need records to settle.
