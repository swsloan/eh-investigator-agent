# L1 Detection Triage Workflow

Use this workflow for detection queues, noise reduction, safe-close
recommendations, and prioritization. L1 triage is deliberately shallow: decide
what is safely benign, what is suspicious enough for L2, and what cannot be
determined from cheap evidence.

## Triage Modes

| Mode | User signal | Depth |
| --- | --- | --- |
| Quick triage | "triage the queue", "latest detections" | Pull, group, rank, summarize; minimal enrichment |
| Find safe closes | "what can I close", "reduce noise", "clear these" | Prioritize high-confidence false positives or benign true positives |
| Find investigations | "what should we investigate", "bad ones" | Surface malicious true positives and undetermined suspicious items for L2 |

If the user does not specify a mode, default to quick triage and avoid state
changes.

## Plan Shape

Represent this workflow with outcome-oriented tasks in the structured
`./investigation-plan`; do not copy a command-by-command checklist into scratch.
A typical L1 plan establishes the scoped population, groups and classifies it,
reconciles safe actions, and hands suspicious items to L2. Add the read-only
accuracy-review outcome only when the user asks for it.

## Step 1: Pull The Scoped Detection Population

Use the detection search/list tool exposed by `./excli-interface`. Confirm its
real arguments with `TOOL -help`.

Default time window is last 24 hours (`from=-86400000`, `until=0` when the tool
uses epoch-millisecond relative offsets). Use the user's explicit window when
given.

Scope server-side only with filters the tool actually supports, commonly:

- detection category, such as security/lateral/exfiltration/IDS;
- detection type;
- status, assignee, resolution, or time range.

Do not assume server-side sorting, participant filtering, risk thresholds,
critical-device filters, or AI-disposition filters exist. Pull the bounded
population, paginate when needed, then rank and filter client-side.

If the scoped pull returns more than a few hundred detections, report the count
and ask whether to narrow by type, category, status, or time before enriching.
This keeps triage from turning into an uncontrolled investigation.

If the scoped pull is unexpectedly empty, verify the status/category/type
filters and time units, widen the window, and relax one constraint at a time.
Try alternate relevant categories or types only when the user's intent supports
them. After three or four defensible attempts, report every attempted scope and
stop; an empty response is not evidence for an invented clean bill of health.

## Step 2: Rank And Group

Rank client-side by:

- higher risk score;
- critical offender or victim device;
- multiple detections that share participants or adjacent attack stages;
- recency or ongoing activity;
- user-stated priority, such as "domain controllers" or "finance segment".

Group detections into one triage unit when they share:

- the same detection type;
- the same offender, victim, or peer;
- a common benign explanation, such as an authorized scanner;
- a plausible attack-stage chain on the same assets.

Singleton groups are fine. Do not merge unrelated high-risk items just because
they appeared in the same queue.

## Step 3: Enrich Cost-Aware

Climb the enrichment ladder only as far as the verdict needs:

1. Bulk detection summary already retrieved: type, category, risk, participants,
   status, resolution, and timestamps.
2. Prior-disposition history: a wider detection search for the same type and
   closed/resolved history, with participant matching client-side.
3. Detection type metadata: cache once per type for meaning, ATT&CK mapping, and
   expected properties.
4. Full detection and activity timeline: spend this on outliers, homogeneity
   breakers, or likely escalations.
5. Device details: resolve OID, display name, role, criticality, discovery ID,
   and IPs for important participants.
6. Metrics: use only when a cheap volume/shape check helps decide priority.
7. Records and packets: stop L1 and escalate to L2 instead.

Do not pull full details for every item in a homogeneous bulk-noise cluster.
Spend detail calls on the detection that could invalidate the batch or needs L2.

## Prior-Disposition History

Recurring benign history is one of the strongest safe-close signals.

For a candidate false-positive or benign cluster:

1. Search a wider time window for the same detection type and closed/resolved
   detections.
2. Match the same participant(s) client-side because detection search may not
   filter by participant.
3. Treat consistent benign or false-positive human handling as corroboration.
4. Treat mixed history, action-taken history, malicious investigations, or
   critical participants as a caution flag.

Use this history to raise or lower confidence. Also use it to recommend a
tuning rule for the operator to create in RevealX: detection type, participant
scope, rationale, and supporting closed detection IDs.

## Step 4: Verdict, Confidence, Disposition, Action

Use these verdicts:

- `False Positive` - detection did not represent the claimed behavior or is
  misattributed.
- `Benign True Positive` - behavior was real and the detection fired correctly,
  but the activity is authorized or expected.
- `Malicious True Positive` - evidence supports unauthorized, malicious, or
  compromise-related behavior.
- `Undetermined` - evidence is insufficient to commit.

Use confidence:

- `High` - direct evidence and benign/malicious alternatives largely settled.
- `Medium` - strong indication but one material gap remains.
- `Low` - suggestive only; do not close as benign.

Map to a disposition when the available CLI supports one:

| Verdict | Confidence | Recommended action | Disposition |
| --- | --- | --- | --- |
| False Positive | High | Close candidate | `false_positive` |
| False Positive | Medium/Low | Leave open or handle individually | `false_positive` or `indeterminate` when too weak |
| Benign True Positive | High | Close candidate | `benign_true_positive` |
| Benign True Positive | Medium/Low | Present individually, usually leave open | `benign_true_positive` or `indeterminate` when too weak |
| Malicious True Positive | High | Escalate or create investigation after L2-level confirmation | `malicious_true_positive` |
| Malicious True Positive | Medium | Escalate to L2 | `malicious_true_positive` |
| Undetermined | Low | Leave open; escalate if suspicious | `indeterminate` |

Default close resolution is `no_action_taken`. Use `action_taken` only when the
conversation or provided evidence shows a real response occurred, such as host
isolation, account disablement, firewall block, or ticket action.

## Step 5: Detection Sets And Safe Close Batches

Use `detection-set-output.md` for chat output. Present one Detection Set per
group with verdict, confidence, evidence, recommended action, and open
questions.

Build a close batch only when every item is homogeneous:

- verdict is False Positive or Benign True Positive;
- confidence is High;
- same detection type or strong shared participant;
- same benign explanation;
- resolution is `no_action_taken`;
- no markedly higher risk score, critical-device exception, inconsistent
  ATT&CK mapping, or unresolved outlier remains in the batch.

Before any close, present the full list of detection IDs to be closed, the count,
the shared verdict/disposition/resolution, the homogeneity rationale, and an
excluded list. One approval can cover the batch, but execution must still be per
detection ID if the CLI exposes a close/update tool.

## Step 6: Execute Only Approved State Changes

Do not change RevealX state until the user approves the exact action.

After approval, use the current CLI help to build the state-change call. Preserve
the separation between:

- status: workflow state, such as closed or open;
- disposition: AI or analyst verdict where supported;
- resolution: whether a response action occurred, such as `action_taken` or
  `no_action_taken`.

Never overwrite human ground truth silently. If a detection was already closed
or assessed by a person, report whether your read agrees or disagrees.

## Step 7: Escalate To L2

Everything not safely closeable and worth deeper work becomes an escalation
queue. Follow `escalation.md` for the full handoff, prioritization, persistence,
and investigation-boundary contract. Each entry should include:

- detection IDs;
- escalation reason;
- priority: High, Medium, or Low;
- preliminary verdict and confidence;
- participants already resolved where available: OID, discovery ID, IPs,
  criticality, and role;
- detection type meaning and ATT&CK techniques when known;
- evidence snapshot: key facts, risk, timeline highlights;
- open questions for L2;
- proposed investigation grouping.

Write a queue file under `scratch/` only when the queue is large enough that
conversation context may be lost. Raw evidence still belongs under `evidence/`.
Otherwise present the queue in chat and immediately continue to L2 when the user
asked to "dig into the bad ones."

## Step 8: Read-Only Accuracy Review

Run this only when the user asks how AI triage verdicts performed.

1. Pull the review window with detection search, paginate fully, and filter
   client-side to detections that have both an AI disposition and a human
   outcome.
2. Rank human ground truth by strength:
   - strongest: investigation assessment;
   - strong: close with `action_taken`;
   - usable: explicit human disposition if present;
   - weak or ambiguous: bare `no_action_taken` close.
3. Report agreement over the strong/usable population.
4. Report missed true positives separately as a headline safety metric: AI
   benign/false-positive verdict, human malicious assessment or action taken.
5. Itemize disagreements by detection ID and pattern.
6. Recommend tuning or workflow changes for the operator.

Do not fabricate an accuracy rate. If strong human-signal count is too small,
report raw counts instead of percentages. This review is read-only.
