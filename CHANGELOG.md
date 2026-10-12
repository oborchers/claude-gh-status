# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A GitHub outage no longer replaces the band and pane with `gh-status: gh: HTTP 504` and waits two minutes. HTTP 500, 502, 503 and 504 and answers that are not JSON (an HTML error page) count as temporary problems. With a pull request on screen it stays, marked `GitHub unavailable (504), retrying` in the band and `showing last data from 2 min ago, GitHub unavailable (504), retrying in 15 s` in the pane. Without earlier data the line reads `GitHub is having trouble (504), retrying in 15 s`. Temporary failures are retried after 15 s, 30 s, then every 60 s, and the wait resets after the first success.
- A write that ends in a 5xx is reported as possibly applied, like a timeout.

## [0.1.0] - 2026-10-12

First release.

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
- Retry failed CI: `t` (band and pane) and `/pr rerun` (`/pr rr`) re-run only the failed jobs of the head commit's failed, timed-out or cancelled Actions runs (`gh run rerun <id> --failed`). Runs that are still in progress are skipped, and the button only appears while a run can be re-run. No confirmation, since it only restarts CI.
- Edited comments count as activity: the pane shows `@bot edited 2 min ago`, "new since you looked" includes edits by others, and a toast says `comment updated by @bot`. The newest of the last 100 comments by creation or edit time is shown, so a review bot that updates an older comment in place surfaces. Edits within 60 seconds of creation (automatic post-processing by bots) do not count. The fast check watches `pulls/{n}/comments` too; edits are seen within the first 100 comments of a list.

[0.1.0]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.1.0
