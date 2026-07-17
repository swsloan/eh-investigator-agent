# Contributing

Thanks for improving the ExtraHop Investigation Agent.

This project uses issue-driven development and pull requests for every change to
`main`. Start by reading [docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md), which is
the source of truth for branch names, commits, validation, review, merging, and
releases.

## Before you start

1. Search the open issues and pull requests for overlapping work.
2. Open or claim an issue with explicit scope and acceptance criteria.
3. Classify the change's risk using the workflow's low/medium/high model.
4. Branch from an up-to-date `main`; do not work directly on `main`.

## Minimum validation

Install the locked dependencies and run the baseline checks:

```bash
npm ci
npm run check
npm test
```

Run the additional checks required by the paths you changed, as described in
[docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md#validation-matrix). Do not claim a
check passed unless you ran it. If a check cannot run, explain why in the pull
request and describe the compensating validation.

Every supported command is listed in the README's
[Developer commands](README.md#developer-commands) table.

## Pull requests

- Keep one primary concern per pull request.
- Link the issue with `Closes #<number>` when the PR fully resolves it.
- Open high-risk or multi-step work as a draft early.
- Include rollout and rollback notes for operational changes.
- Disclose AI assistance and confirm that a human reviewed the complete diff.
- Never include credentials, customer data, investigation workspaces, or local
  deployment state.

Security vulnerabilities should not be filed as public issues. Use the
repository's private security-advisory reporting link instead.
