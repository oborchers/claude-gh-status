# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-10-12

### Changed

- The list and the detail of a pull request share one pane (`gh-status`) instead of two. Enter or a click on a row opens the pull request in place; `b` or `l` (or `/pr back`) return to the list with the focus on the same row, keeping the page and the draft filter. The header of a picked pull request shows `b: back to list`; the branch's pull request shows `l: all PRs`.
- One focus stop per pull request, with a calm two-line highlight (a `▸` marker, the same highlight under the mouse pointer) instead of two buttons per pull request.
- The list is read every 60 s only while the pane shows it.

### Fixed

- Color blocks on the focused row of the list.
- Enter in the list and `l` in the detail did not move between the two views.

## [0.2.0] - 2026-10-12

### Added

- List of the repository's open pull requests: `l` in the pane (and in the band when the branch has no pull request), `/pr list` (`ls`), and `/pr` alone when the branch has no pull request. Grouped as Yours, Review requested from you, Waiting for review, Other open; two lines per pull request; 10 per page with `n` and `p`; `h` hides drafts; read every 60 s while open.
- Open any pull request in the detail pane: pick a row or `/pr <number>`. The pane shows `(selected)` and `b` (`/pr back`) returns to the branch's pull request. Merge, queue and the other actions act on the pull request the pane shows.
- Reviews from the pane: `v` approve (optional comment), `w` request changes (text required), with `/pr approve` and `/pr changes`. The confirmation shows repository, number, head commit, account and the exact text; Enter in the text field does not post. Reviews are bound to the head commit you saw.
- Ready for review for your own drafts: `e` and `/pr ready`.
- Counts in the band: `N open · N yours · N review requested` when the branch has no pull request, read every 5 minutes.
- An `N open` count at the end of the band row when the branch has a pull request.

### Changed

- Draft titles in the list are dim.
- The band's confirmation shows `owner/repo #N`, the short head commit and the account.
- A low rate limit (fewer than 500 points) holds the list and counts polling to every 5 minutes.
- Approve, request changes and ready for review treat a timeout or a server error as an unknown result: the confirmation is cleared, the status is refreshed, and nothing is retried.
- The demo pipeline fails only on some demo branches, so the list shows passing, running and failing rows.

### Fixed

- A change of repository clears a selected pull request, its data and a pending write.
- Review text is cut at 65,000 characters without splitting a character, and a press whose text differs from the text drawn is refused.
- The list and counts timers are cancelled when a second session starts.

## [0.1.4] - 2026-10-12

### Changed

- The marketplace is named `claude-gh-status` (was `oborchers`), so it no longer collides with other marketplaces of the same owner. The plugin id is now `gh-status@claude-gh-status`. To move an existing install: `claude plugin uninstall gh-status@oborchers`, `claude plugin marketplace remove oborchers`, then install again with the line from the README.

### Fixed

- `/pr` was unreachable in a project with a skill or command of the same name (for example `.claude/skills/pr`): the typeahead showed only the skill. The mod now registers its command only when the name is free, always also registers `/gh-pr`, and shows a toast once per session when the configured name is taken. New setting `command` (Command name, default `pr`) changes the name; usage and error texts show the name in use.

## [0.1.3] - 2026-10-12

### Fixed

- Checks that did not run (skipped, neutral) are listed below the ones that ran.
- A workflow that ran twice on the same commit no longer lists every check twice: only the latest run per workflow and check name is shown and counted, as GitHub judges mergeability.

## [0.1.2] - 2026-10-12

### Fixed

- GitHub's GraphQL errors "Something went wrong while executing your query" and "We couldn't respond to your request in time" count as temporary problems: the last data stays on screen and the mod retries after 15, 30, 60 s.
- README: the pane docks from 110 columns in the fullscreen layout.

## [0.1.1] - 2026-10-12

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

[0.2.0]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.2.0
[0.1.4]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.1.4
[0.1.3]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.1.3
[0.1.2]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.1.2
[0.1.1]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.1.1
[0.1.0]: https://github.com/oborchers/claude-gh-status/releases/tag/v0.1.0
