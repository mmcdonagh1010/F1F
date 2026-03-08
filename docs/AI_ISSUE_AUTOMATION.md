# AI Issue Automation

This repository can auto-generate reviewable pull requests from GitHub issues.

## What It Does

- Watches for GitHub issues labeled `ai-fix`
- Reads the issue title, body, and comments
- Runs an AI coding agent against the repository
- Validates the generated changes before opening a pull request
- Opens one PR per issue for human review before anything reaches `main`
- Re-runs validation on every PR update

## Required GitHub Setup

Add these repository settings before using the workflow.

### Secrets

Add at least one of these:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

### Repository Variable

Optional but recommended:

- `AI_AGENT_MODEL`

Examples:

- `gpt-4.1`
- `claude-3-7-sonnet-20250219`

If no variable is set, the workflow defaults to `gpt-4.1`.

## How To Use It

1. Create or refine a GitHub issue with a clear expected outcome.
2. Add the `ai-fix` label to that issue.
3. Wait for the `AI Issue To PR` workflow to run.
4. Review the generated pull request.
5. Merge only after the `PR Validation` workflow is green.

You can also run the workflow manually from the Actions tab with an issue number.

## Validation Coverage

The automation currently validates:

- `npm --prefix backend run validate`
- `npm --prefix frontend run build`

Backend validation imports the backend models, middleware, routes, services, and config modules to catch syntax and dependency errors early.

## Important Limits

- The AI agent still needs a well-written issue. Vague issues will produce weak PRs.
- The workflow opens PRs for review; it does not merge automatically.
- Branch protection should require the `PR Validation` workflow before merging to `main`.
- Issue text is treated as untrusted input in the generated prompt, but you should still review workflow and secrets changes carefully.