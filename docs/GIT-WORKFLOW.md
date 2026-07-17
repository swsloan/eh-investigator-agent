# Git work process

This document is the project-wide source of truth for planning, branching,
committing, reviewing, merging, and releasing changes.

## Roadmap sequence

Larger initiatives are planned as an ordered set of GitHub issues, each with its
own scope, dependencies, and acceptance criteria. Find the current roadmap by
filtering the issue tracker for the
[`roadmap` label](https://github.com/swsloan/eh-investigator-agent/issues?q=is%3Aissue+state%3Aopen+label%3Aroadmap),
and work the phases in the order their recorded dependencies require.

Respect the dependencies recorded in those issues. Do not combine phases into a
single pull request.

## Operating principles

- `main` must remain deployable and is changed only through pull requests.
- An issue defines the problem, scope, acceptance criteria, and validation plan.
- A branch and pull request should address one primary issue or concern.
- Prefer small, reversible changes. Split design, implementation, and migration
  when a single change would be difficult to review or roll back.
- Preserve existing deployments and persisted data unless a migration is
  explicitly approved and documented.
- Treat agent permissions, credentials, governed writes, authentication,
  network access, and container boundaries as high-risk surfaces.

## 1. Create or select an issue

Use the task form for planned work and the bug form for defects. Every issue
should contain:

- the user or operator problem;
- explicit in-scope and out-of-scope boundaries;
- testable acceptance criteria;
- dependencies and rollout constraints;
- a validation plan;
- a risk classification.

Use task lists for independently verifiable work. Update the issue when scope or
design changes; do not let the pull request become the only plan of record.

## 2. Classify risk

### Low risk

Documentation, comments, repository metadata, and generated artifacts that do
not change runtime behavior.

Requirements: relevant formatting/build validation and a complete diff review.

### Medium risk

UI behavior, read-only API behavior, evaluation logic, non-secret persistence,
and ordinary dependency changes.

Requirements: unit or integration tests for changed behavior, baseline checks,
and a manual smoke test when the UI or deployment surface changes.

### High risk

Secrets, authentication, local-origin protections, agent execution permissions,
governed writes, broker boundaries, uploads/path handling, network egress,
container isolation, destructive migrations, and production deployment logic.

Requirements:

- a threat-model or failure-mode note in the issue or PR;
- explicit rollout and rollback instructions;
- negative tests for denied/failed paths;
- an independent review when available;
- validation against a disposable or non-production environment before rollout;
- no direct production deployment from an unreviewed branch.

## 3. Create a branch

Update `main`, then create a short, descriptive branch:

```bash
git switch main
git pull --ff-only
git switch -c <type>/<short-description>
```

Allowed prefixes:

- `feat/` — user-visible capability
- `fix/` — defect correction
- `security/` — security hardening
- `eval/` — evaluation cases, scoring, or harness behavior
- `docs/` — documentation only
- `chore/` — tooling, CI, dependencies, or repository maintenance
- `hotfix/` — urgent production correction
- `agent/` — AI-agent-authored work before it is categorized or handed off

Use lowercase kebab-case after the prefix. Include an issue number when useful,
for example `security/22-memory-proxy-token`.

## 4. Commit intentionally

Commit complete, reviewable steps. Use an imperative subject with a conventional
type when it improves clarity:

```text
feat(memory): add namespace selector
fix(actions): verify persisted detection state
test(proxy): cover oversized request rejection
docs: define the git work process
```

Do not mix formatting churn, generated outputs, dependency updates, and product
logic unless they are inseparable. Never commit `.env`, secrets, customer data,
workspaces, logs, tokens, or machine-specific deployment state.

AI-assisted commits remain human-owned. The author must inspect the complete
diff, run the claimed validation, and understand any generated code before push.

## 5. Validate

### Baseline checks

Run for every code change:

```bash
npm ci
npm run check
npm test
```

### Validation matrix

| Changed area | Additional validation |
| --- | --- |
| `public/`, browser behavior | Browser smoke coverage and a console-error check |
| `routes/`, `server.js`, brokers | Route/integration tests including rejected paths |
| `eval/`, evidence-ladder skill | `bash eval/dashboard/ci.sh` and relevant replay/live evaluation |
| Docker or Compose | `docker compose config` and a clean image build |
| Bootstrap or shell scripts | Shell syntax/static analysis and a disposable-host smoke test |
| Governed writes | Read-only denial, approval, execution failure, and read-back verification tests |
| Secrets/auth/network boundaries | Negative security tests plus threat-model review |
| Documentation only | Link/path review and any referenced generator/check |

If an advertised check is not currently wired up (for example, the browser-smoke
or packaging commands), record that gap openly in the pull request rather than
treating the check as successful.

## 6. Open a pull request

Push the branch and open a draft PR when work is still evolving:

```bash
git push -u origin HEAD
```

Complete the pull request template. The PR must explain what changed, why, its
risk, validation evidence, operator impact, and rollback plan. Link the issue;
use `Closes #<number>` only when all acceptance criteria are met.

Keep the diff focused. If review uncovers unrelated work, open a follow-up issue
instead of silently expanding scope.

## 7. Review and merge

Before merge:

1. All required checks pass.
2. Every review comment is resolved or explicitly deferred to a linked issue.
3. The author performs a final diff and secret scan.
4. Documentation and migration notes match the shipped behavior.
5. High-risk changes have rollout/rollback approval and non-production evidence.

Use squash merge by default so the PR title becomes the durable change summary.
Delete the merged branch. Rebase or update the branch when required checks are
stale; never force-push `main`.

## 8. Release and deploy

Releases are deliberate changes, not a side effect of merging:

1. Confirm `main` is green and the target commit is known.
2. Update the single canonical version and release notes once the project
   establishes them.
3. Build from a clean checkout using pinned inputs.
4. Record artifacts, checksums, SBOM/provenance, migration steps, and rollback.
5. Tag the reviewed commit and publish the release.
6. Deploy with `scripts/deploy.sh` only after checking for active investigations
   and persisted-data compatibility.
7. Verify health, preflight, session restore, and the changed capability.

For a hotfix, use `hotfix/<description>`, keep the diff minimal, apply the same
required checks, and create a follow-up issue for root cause and prevention.
