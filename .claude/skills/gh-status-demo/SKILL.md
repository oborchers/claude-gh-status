---
name: gh-status-demo
description: Set up a live demo of the gh-status mod for README screenshots or a walkthrough. Use when asked to "make a demo", "take screenshots of gh-status", "show the band and pane with a running pipeline", or to refresh the README images. Covers the demo pipeline, the demo branch and pull request, demo comments, the terminal layout for the tab view and the compact view, and cleanup.
---

# gh-status demo

A demo needs a pull request whose pipeline is visibly alive: many jobs, several steps per job, some running, one failing, a few skipped, plus a comment and an unresolved review thread. This repository ships such a pipeline in `.github/workflows/demo.yml`. It runs only on pushes to `demo/**` branches and only sleeps, so it is safe and cheap (free on a public repository).

Never take demo screenshots in a work or client repository: PR titles, branch names, org names and check names would leak into the public README.

## 1. Create the demo branch and pull request

Run from the repository root. Pick a fresh branch name per demo run so a new pipeline starts.

```bash
git fetch origin
git worktree add -b demo/checkout-flow ../gh-status-demo origin/main
cd ../gh-status-demo
mkdir -p demo
printf '# Checkout flow\n\nDemo change used to show gh-status in the README.\n' > demo/checkout-flow.md
git add demo && git commit -m "feat: add checkout flow"
git push -u origin demo/checkout-flow
gh pr create --base main --head demo/checkout-flow \
  --title "feat: add checkout flow" \
  --body "Demo pull request for gh-status README screenshots. Its pipeline only sleeps; one job fails on purpose."
```

If the demo workflow is not on `main` yet, base the branch and the pull request on the branch that has it.

Use the account that owns the repository. If `gh` is logged in with several accounts, run the `gh` commands with `GH_TOKEN=$(gh auth token -u <owner-login>)` instead of switching the global account.

### Demo pull requests for the list

The list needs several pull requests. Create a few more branches the same way, all named `demo/*`, each with its own file under `demo/` and its own pull request, and make one of them a draft (`gh pr create --draft`). Add labels (create them with `gh label create`, then `gh pr edit <n> --add-label <name>`) so the label colors show.

The demo pipeline fails only on `demo/checkout-flow` and `demo/invoice-rounding`; all other `demo/*` branches pass. That gives passing, running and failing rows in one list. Shortly before the screenshot, push an empty commit to one passing branch (`git commit --allow-empty -m "chore: rerun" && git push`) so that its row shows as running.

## 2. Add a comment and an unresolved thread

Comments are posted as the person. Show them the exact texts first and post only after they approve. Suggested texts:

```bash
gh pr comment <n> --body "Looks good overall. Can we add a test for the empty cart case before merging?"
SHA=$(gh pr view <n> --json headRefOid --jq .headRefOid)
gh api repos/<owner>/<repo>/pulls/<n>/comments \
  -f body="Should this mention the payment provider fallback?" \
  -f commit_id="$SHA" -f path=demo/checkout-flow.md -F line=3 -f side=RIGHT
```

The pane then shows `1 unresolved thread` with `demo/checkout-flow.md:3` and the last comment.

## 3. Start a session with the mod

```bash
cd ../gh-status-demo
claude --plugin-dir <path-to-this-repo>
```

Type `/pr` to open the detail pane. The band above the prompt shows the short status.

## 4. Lay out the terminal

The pane docks as a sidebar when the session is wide and opens inline above the prompt when it is narrow. Observed: at about 147 columns by 41 rows `/pr` docks; at 120 columns it still docks; at about 100 columns it opens inline. If the pane still docks in the compact view, close it (`/pr close`), narrow the session further and run `/pr` again.

On a wide monitor, frame the session with empty panes. In Herdr (when the person uses it), from the demo tab's pane `<p>`:

```bash
herdr pane split <p> --direction right --ratio 0.8 --no-focus    # right spacer
herdr pane split <p> --direction right --ratio 0.25 --no-focus   # middle pane
herdr pane swap --direction right --pane <p>                     # session to the middle
herdr pane split <p> --direction down --ratio 0.75 --no-focus    # bottom spacer
herdr pane layout --pane <p>                                     # check the size
herdr pane resize --direction down --amount 0.1 --pane <p>       # adjust
```

Read the session with `herdr pane read <p> --source visible` to confirm the state before asking for a screenshot. Herdr cannot take images; the person takes the screenshots.

## 5. Take the screenshots

Timing after the push (the demo jobs sleep):

- 0:30 to 2:00: unit shards running, each with `▸ Run tests`. Good for "pipeline running".
- about 1:30: `Integration (payments)` fails with `✗ Run integration tests`.
- 2:30 to 5:00: E2E jobs run with their steps while the integration job is red. Best moment for the full picture.
- after about 5:30: everything settled, pipeline failed.

Take five views:

1. Tab view: terminal about 147x41 cells, `/pr` docked on the right, band above the prompt.
2. Compact view: terminal about 100 columns, `/pr` inline above the prompt.
3. Band: a single-row crop of the band.
4. List view (`docs/images/list-view.png`): `/pr list`, with the demo pull requests above, a draft among them and labels set.
5. Selected view (`docs/images/selected-view.png`): pick a row in the list; the pane shows `(selected)` and `b: back`.

Method (herdr, headless Playwright, no OS screenshots):

```bash
herdr pane read <p> --source visible --format ansi > x.ansi
python3 scripts/ansi2html.py --font-dir <font-folder> --font-family "<Font Name>" x.ansi shot.html <first_row> <last_row>
```

- Pick the row range so it excludes the status line below the prompt (session id, usage). Check the rows with `sed -n` on the capture. For the band, use the single band row.
- Use the person's own terminal font: read it from their terminal config (for Ghostty, `font-family` in its config) and find the Regular and Bold `.ttf` files. The script copies them next to the HTML and loads them with `@font-face`.
- Render with the headless Playwright MCP at `deviceScaleFactor` 2 (page viewport wide enough for the window) and screenshot the `.win` element with `omitBackground`, so the rounded corners stay transparent.
- Save to `docs/images/*.png`.
- Review the images for personal data (paths, usernames, account names) before they go into the README.

Leave the merge queue out: GitHub offers it only for organisation repositories.

To show the confirmation, press `m` in the band (click the band first) or type `/pr merge`, take the screenshot, then press `n`. Never press `y` in a demo unless the person asked for a real merge.

## 6. Clean up

```bash
gh pr close <n> --delete-branch
git worktree remove ../gh-status-demo
git branch -D demo/checkout-flow
```

Ask before closing a demo pull request the person may still want to show.
