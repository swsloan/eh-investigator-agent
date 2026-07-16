# Write-path validation notes

Findings from validating the governed write path (propose → approve → execute,
PR #12) against a live RevealX appliance (`eh-lab`). The path itself is confirmed
working end to end; this note records appliance behaviors that surprised us so
they aren't re-discovered later.

## `update_detection` can report success without persisting a field

**Observed:** approving an `update_detection` action that set `ticket_id` to a
value returned `{"message": "Detection updated successfully."}` (exit 0), and the
approval tray correctly showed **EXECUTED** — but a subsequent `get_detection`
read-back showed `ticket_id` was still `null`. The value did not persist.

**Cause:** `ticket_id` is tied to ExtraHop **ticket tracking**. When no ticket-
tracking integration is configured on the appliance, the REST API *accepts* the
`ticket_id` in the PATCH (HTTP 200) but does not store it. This is appliance
configuration behavior, **not** a defect in the write path — excli ran, the
appliance authenticated and processed the request, and we reported its success
faithfully.

**Implications for us:**
- A green `EXECUTED` means "the appliance accepted the write," which is not always
  the same as "the field now holds the value." For fields gated on appliance
  configuration (ticket tracking, integrations), accepted ≠ persisted.
- The agent already handles this well by discipline: after the write it did a
  `get_detection` read-back, caught the discrepancy, and **refused to fire a
  no-op reversal** ("the detection is already in the state the reversal would
  produce"). This is the "look at the target before overwriting" behavior working
  as intended — worth preserving.
- Fields that persist reliably regardless of integrations (e.g. `status`,
  `assignee`) are better choices for a smoke test that must *visibly* change and
  revert state.

**Possible future refinement (not implemented):** an optional post-execute
read-back verification for write actions, surfacing "accepted but not persisted"
distinctly from "executed and confirmed." The agent does this manually today;
formalizing it would be a product decision. Tracked informally here rather than
as an issue, since it depends on appliance configuration and may not be worth the
added complexity.

## Reversible fields for a smoke test

For a low-impact, fully reversible write-path check against a real appliance:
- Prefer a **pristine detection** (no status, assignee, or ticket set).
- `assignee` / `status` persist reliably and are reversible (set, verify, restore).
- `ticket_id` only persists with ticket tracking configured — avoid it as a smoke
  test unless you know tracking is enabled.
- Device tags require the tag to **already exist** (`assign_devicetag_to_devices`
  returns `tag "<name>" not found` otherwise), and there is no create-tag tool in
  the exposed set — so tags are a poor first smoke test on a fresh appliance.
