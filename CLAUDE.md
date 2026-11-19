# Kairo: instructions for Claude

- Never add AI attribution anywhere: no `Co-Authored-By`, `Claude-Session` or "Generated with" lines in commits, PRs, issues or files. The `.githooks/commit-msg` hook enforces this.
- Commit as the repo author (Bhavy Ladani). Keep commit messages short, lowercase, imperative.
- Work on `main` unless a branch is genuinely needed.
- Secrets never enter the repo or the browser. Kite credentials live in `.env` on the server only.
- Read `docs/architecture.md` before structural changes; record significant decisions in `docs/adr/`.
