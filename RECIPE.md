# Jujutsu Changes

The Changes panel for Jujutsu repos. Open it in a space whose terminal is in a jj repo and it lists what the working-copy change `@` changes, with each file's diff and a box to commit it with `jj commit`. Outside jj it is the shipped git Changes panel.

## What you see

- Header (42px): "Changes", a `N files` pill, a `jj` pill in jj repos, then `+add` (ansi2) and `−del` (ansi1) totals.
- jj only: a 28px row `@ <change id (accent)> <description, or "(no description)" dim>`, and a red `conflict` pill when `@` has conflicts.
- The file list (28px rows: status letter A/M/D/U, dim folder + name, +/- counts), the diff below it (20px rows, line numbers, green/red tints), and the commit input + button at the bottom, all exactly as the shipped `changes` mod.
- Empty states: "No changes in @" (jj), "No uncommitted changes" (git), "Not a git or jj repository".

## How it behaves

- Agent statuses play no part.
- Click a file to show its diff, click again to close it. The first file opens by itself.
- Commit (Enter or the button): jj → `jj commit -m <message>` (describe `@`, start a new empty change); git → `git add -A && git commit -m`.
- Refreshes when the focused pane's folder changes, every 10 s, and on folder changes in the repo (not on its own `.jj/` / `.git/` writes).

## Built from

- `mod.clone {"name":"changes","as":"jj-changes"}`, then `main.js` edited. `mod.json`: `{"place":"none"}` plus `cloned_from`.
- `herdr`: `spaces`, `panes`, `focused`, `exec`, `readTextFile`, `watchFolder`, `theme`, `settings`.
- Programs: `jj` (`root`, `log -r @ -T …`, `diff --git`, `resolve --list`, `commit`), `git` as shipped.
- Status template: `change_id.shortest(8) ++ "\t" ++ if(conflict,"1","0") ++ "\t" ++ description.first_line() ++ "\n" ++ self.diff().stat().files().map(|f| f.status_char() ++ "\t" ++ f.lines_added() ++ "\t" ++ f.lines_removed() ++ "\t" ++ f.path()).join("\n")`.
- Left bar: `spaces-icons.patch` adds `checkJj()` to a `spaces` clone: `heads(::@ & bookmarks())` → bookmark name; `heads(::@ & bookmarks())..@ ~ empty()` → ahead; else `@<shortest change id>`. All with `--ignore-working-copy`.

## Watch out

- Shipped mods are replaced on start: never edit `changes` itself.
- jj commands without `--ignore-working-copy` snapshot and write under `.jj/` (and `.git/` when colocated); a watch that refreshes on those loops forever.
- Pass paths as `root-file:"<path>"`: a bare path is a fileset expression (spaces, parens, globs break it).
- `f.path()` is repo-relative regardless of cwd.
- `jj git init` colocates by default now; test jj-only repos with `--no-colocate`.

## Done when

- `herdr-app check` passes for `jj-changes` and the patched spaces mod; `herdr-app status` shows no errors.
- In a jj repo with edits, the panel shows the `jj` pill, `@ <id>`, every changed file with counts, and a diff.
- Commit leaves `@-` described and an empty `@`; the panel empties.
- A plain git repo looks and behaves like the shipped panel.
- With the panel open and nothing changing, `jj op log` doesn't grow.
- A colocated jj space in the left bar shows its bookmark and `↑N`, not `detached`.
