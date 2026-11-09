// jj-status: the shipped status bar, Jujutsu-aware. In a jj repo the branch label shows the
// nearest local bookmark at or below @ with the non-empty changes since it (↑N), and the
// workspace's name when it isn't the main one; with no bookmark, the workspace's name.
// Elsewhere it shows the space's git branch, as shipped.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, agents, theme, run, window, keys, exec, readTextFile } from "herdr";

// Looked at again this often while the same folder stays in front.
const EVERY = 10000;

// The shown space's folder: its focused pane's, else where the space was made.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

// { bookmark, ahead, workspace, main } for a folder in a jj repo, null elsewhere (or no jj there).
// --ignore-working-copy: no snapshot, nothing written.
async function jjInfo(cwd, on) {
  const jj = (args) => exec("jj", ["--ignore-working-copy", "--no-pager", "--color=never", ...args], { cwd, on }).catch(() => null);
  const root = await jj(["root"]);
  if (!root || root.code !== 0) return null;
  const top = root.stdout.trim();
  // An added workspace's .jj/repo is a file pointing at the main one's.
  const main = !(await readTextFile(`${top}/.jj/repo`, { on }).catch(() => null))?.trim();
  const list = await jj(["workspace", "list", "-T", 'name ++ "\\t" ++ root ++ "\\n"']);
  const workspace = list?.code === 0
    ? list.stdout.split("\n").map((l) => l.split("\t")).find(([, path]) => path?.replace(/\/+$/, "") === top)?.[0] ?? null
    : null;
  const near = await jj(["log", "-r", "heads(::@ & bookmarks())", "--no-graph", "-T", 'local_bookmarks.map(|b| b.name()).join(" ") ++ "\\n"']);
  const bookmark = near?.code === 0 ? near.stdout.split("\n")[0]?.split(" ")[0] || null : null;
  let ahead = 0;
  if (bookmark) {
    const since = await jj(["log", "-r", "heads(::@ & bookmarks())..@ ~ empty()", "--no-graph", "-T", '"x"']);
    ahead = since?.code === 0 ? since.stdout.trim().length : 0;
  }
  return { bookmark, ahead, workspace, main };
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.jj = null;
    this.refresh(cx);
    cx.timer.every(EVERY, (cx) => this.refresh(cx, true));
  }

  // On a new folder or space at once; on the timer only while the window is in front.
  refresh(cx, timed = false) {
    const loc = location(), key = JSON.stringify(loc);
    if (this.loading || (timed && !window()?.active)) return;
    if (key !== this.key) { this.key = key; this.jj = null; }
    if (!loc.cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const info = await jjInfo(loc.cwd, loc.on);
        if (JSON.stringify(location()) === key) this.jj = info;
      } finally { this.loading = false; cx.notify(); }
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // jj: "main ↑2 · feat" (bookmark, ahead, an added workspace's name), or the workspace's name.
  jjLabel(j, t) {
    const parts = [];
    if (j.bookmark) parts.push(div().child(j.bookmark));
    if (j.bookmark && j.ahead > 0) parts.push(div().text_color(t.ansi2).child(`↑${j.ahead}`));
    const ws = j.workspace && (!j.bookmark || !j.main) ? j.workspace : null;
    if (ws) parts.push(div().text_color(t.dim).child(j.bookmark ? `· ${ws}` : ws));
    return parts.length ? h_flex().gap(5).items_center().children(parts) : null;
  }

  render(cx) {
    if (JSON.stringify(location()) !== this.key) this.refresh(cx);
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const jj = this.jj && this.jjLabel(this.jj, t);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(jj), el => el.child(label("branch", jj)))
      .when(!this.jj && Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
