# Jujutsu for Herdr.app

[Jujutsu (jj)](https://jj-vcs.github.io/jj/) support for [Herdr.app](https://herdr.dev):

- **`jj-changes`**: the Changes panel, jj-aware. In a jj repo (colocated or not) it lists the working-copy change `@` against its parent with +/- counts, shows each file's diff, and its **Commit** button runs `jj commit -m`. A header row shows `@ <change id> · <description>` and a `conflict` badge. Anywhere else it is the shipped git panel, unchanged.
- **`spaces-icons.patch`**: the left bar. Instead of git's `detached`, a jj repo's space shows its nearest local bookmark and `↑N` (non-empty changes since it), or `@<change id>` when no bookmark is below `@`. Written for a `spaces` clone (`spaces-icons`); the same `check()` / `checkJj()` change applies to any clone of the shipped `spaces`.

## Install

```sh
cp -R mods/jj-changes ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/jj-changes
```

Copy, don't symlink: Herdr.app doesn't hot-reload a symlinked mod folder.

### Layout change (required for the panel)

Installing the mod doesn't show it anywhere: a layout picks which mod each block shows, and the shipped `changes` mod can't be replaced (Herdr restores shipped mods on every start). Point your layout's Changes block at `jj-changes`, in `~/.config/herdr-app/layouts/<your-layout>.json` (the shown one is `"layout"` in `herdr-app status`):

```diff
 { "id": "changes", "type": "block",
-  "content": { "mod": "changes" } }
+  "content": { "mod": "jj-changes" } }
```

- Keep the block id `changes`: the tab bar's **Changes** button opens the node by that id.
- Do it in every layout you use. Shipped layouts (`main`, `terminals`, `win98`) are read-only: clone one first (`herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`, which also switches to it), then edit the clone.
- Undo: put `"changes"` back.

### Left bar (optional, no layout change)

The left bar is patched in place: it's a code change to your own clone of `spaces`, which your layout already shows.

Left bar (your own clone of `spaces`, e.g. `mod.clone {"name":"spaces","as":"my-spaces"}`):

```sh
cd ~/.config/herdr-app/mods && patch -p1 < /path/to/spaces-icons.patch   # paths are spaces-icons/main.js
```

## How it works

- jj is tried first (`jj root`); no jj on that machine or not a jj repo → git, as shipped. Remote machines (`exec … {on}`) work the same way.
- File list: one `jj log -r @ -T …` with `self.diff().stat().files()` (status, lines added/removed, path). It snapshots the working copy, so new edits appear.
- Diff: `jj diff --git -r @ -- root-file:"<path>"`.
- Every jj call writes under `.jj/` (and `.git/` when colocated). Watch batches made only of those, within 2 s of the panel's own jj call, are ignored, so the panel doesn't refresh itself in a loop. Ops from elsewhere (`jj new`, `jj squash` in a terminal) still refresh it.
- The left bar uses `--ignore-working-copy` (no snapshot, no writes). It watches `.jj/repo`.

## Limits

- Requires jj ≥ 0.33-ish (`DiffStatEntry` templates); tested with 0.47.1.
- Renames show under the new path only.
- The panel snapshots the working copy on each refresh (every 10 s and on file changes), like running `jj st`. If that lands mid-way through a `jj describe`/`squash` in a terminal, jj merges the two operations; rarely, `@` can end up divergent.
- A jj op run in a terminal within 2 s of the panel's own refresh is taken for its echo. The list then catches up on the next 10 s tick.
- The sidebar doesn't snapshot, so `↑N` ignores edits not yet snapshotted, and plain `git` ops in a colocated repo show after the next jj command.
- A git repo nested inside a jj workspace shows the outer jj repo.
- The bottom status bar (shipped `workspace-status`) still uses the core's git branch, empty in a colocated jj repo.

## License

MIT
