# CLAUDE.md

Project instructions for Claude Code working in this repo.

## Git workflow

- Commit and push **directly to `main`**. Do **not** create feature branches, and do **not** open pull requests for changes in this repo.
- Pushing to `main` runs the GitHub Actions pipeline (unit tests + typecheck → build → `wrangler deploy` to Cloudflare), so every push to `main` deploys to production.
