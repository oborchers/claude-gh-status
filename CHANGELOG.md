# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- README with screenshots, a compact inline view for narrow terminals, and a demo skill (`.claude/skills/gh-status-demo`) for refreshing them.
- Band above the prompt with the pull request number, state badge, verdict (red with the first caveat when GitHub allows the merge anyway, yellow while checks run, green only when clean), pipeline, reviews, unresolved threads and account.
- `/pr` detail pane with merge section, reviews, conversation, merge queue position and checks and the full pipeline with the running step per job.
- Live updates: a conditional-request check every 5 s while checks run, every 30 s when idle, and a full refresh on change or at least every 60 s.
- Immediate refresh after git push and similar commands, at turn end and on directory change.
- Toasts for changes in the pipeline, reviews, comments and mergeability.
- Confirmed write actions: merge, add to and remove from the merge queue, auto-merge on and off, and admin merge in two steps. The confirmation is inline in the band and the pane, and `/pr m|q|dq|a|x` are short aliases that open the pane with the keyboard.
- `f` puts a reference to the failed CI jobs into the prompt for Claude.
- Account selection per repository without `gh auth switch`.
- Settings: account per owner, fast and idle intervals, toasts, color scheme.
- Marketplace file for installing with `/plugin install`.

[0.1.0]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.1.0
