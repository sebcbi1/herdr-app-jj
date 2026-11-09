// jj-workspace: the worktree dialog for Jujutsu. { space, action: "new" | "open" | "remove" }.
// New: `jj workspace add` in <home>/.herdr/worktrees/<repo>/<name> (on the bookmark of that
// name when there is one) and a space there. Open: every workspace of the repo. Remove:
// `jj workspace remove`, which snapshots the working copy into a commit before deleting it.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, exec, home, readTextFile } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Workspaces go where the worktree dialog puts checkouts: <ROOT>/<repo>/<name>.
const ROOT = (home) => `${home}/.herdr/worktrees`;
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const slug = (name) => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
// A jj string literal (revsets, templates).
const lit = (s) => JSON.stringify(s);

async function jj(cwd, args, on, timeout) {
  const r = await exec("jj", ["--no-pager", "--color=never", ...args], { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

// a/b/../c → a/c, relative to `from`.
function resolve(path, from) {
  const out = [];
  for (const part of (path.startsWith("/") ? path : `${from}/${path}`).split("/")) {
    if (part === "..") out.pop(); else if (part && part !== ".") out.push(part);
  }
  return "/" + out.join("/");
}

// The repo a folder belongs to: this workspace's root (`top`), the main workspace's
// (`main`), the repo's name, and whether this is an added workspace. null outside jj.
async function repoOf(folder, on) {
  const root = await jj(folder, ["--ignore-working-copy", "root"], on);
  if (!root.ok) return null;
  const top = root.out;
  const pointer = (await readTextFile(`${top}/.jj/repo`, { on }).catch(() => null))?.trim();
  const main = pointer ? resolve(pointer, `${top}/.jj`).replace(/\/\.jj\/repo$/, "") : top;
  return { top, main, name: main.split("/").pop(), linked: Boolean(pointer) };
}

// Every workspace of the repo, the main one first: { name, path, change, description }.
async function workspaces(repo, on) {
  const T = 'name ++ "\\t" ++ target.change_id().shortest(8) ++ "\\t" ++ root ++ "\\t" ++ target.description().first_line() ++ "\\n"';
  const r = await jj(repo.top, ["--ignore-working-copy", "workspace", "list", "-T", T], on);
  if (!r.ok) throw new Error(r.err || "jj workspace list failed.");
  return r.out.split("\n").filter(Boolean).map((line) => {
    const [name, change, path, ...rest] = line.split("\t");
    return { name, change, path: path.replace(/\/+$/, ""), description: rest.join("\t"), main: path.replace(/\/+$/, "") === repo.main };
  }).sort((a, b) => b.main - a.main || a.name.localeCompare(b.name));
}

// Folders deleted by hand stay listed by jj: mark them so they aren't opened.
async function markMissing(list, on) {
  for (const w of list) {
    const r = await exec("test", ["-d", w.path], { on }).catch(() => null);
    w.missing = r ? r.code !== 0 : false;
  }
  return list;
}

// The space showing a workspace: its first terminal is in it (the deepest one wins).
function spaceOf(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

export default class Workspace extends View {
  init(_props, cx) {
    this.on = this.space()?.machine ?? null;
    this.userHome = this.on ? null : home();
    this.action = props()?.action ?? "open";
    this.opening = this.action === "open";
    this.text = "";
    this.list = undefined; // the workspaces, once read
    this.at = 0;
    this.input = InputState.new({ placeholder: this.opening ? "filter jj workspaces" : "workspace name (a bookmark of that name is used as its base)" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    if (this.action !== "remove") {
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in jj
    this.handle = cx.focus_handle();
    if (this.action === "remove") this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on });
          if (r.code !== 0 || !r.stdout.trim()) throw new Error("Could not find the remote home folder.");
          this.userHome = r.stdout.trim();
        }
        this.folder = place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until it's known.
        const repo = await repoOf(this.folder, this.on);
        if (repo) this.list = await markMissing(await workspaces(repo, this.on), this.on);
        if (repo) this.self = this.list.find((w) => w.path === repo.top) ?? null;
        this.repo = repo;
        cx.notify();
      } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
    });
  }

  // From the menu: props().space. Opened with `mod.open jj-workspace` (no props): the shown space.
  space() {
    const id = props()?.space;
    return id ? spaces().find((s) => s.id === id) : spaces().find((s) => s.active);
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.opening) return this.open(this.shown()[this.at]);
    if (this.busy || !this.repo) return;
    cx.spawn(async (cx) => {
      this.busy = true; this.error = ""; cx.notify();
      try { this.error = this.action === "remove" ? await this.remove() : await this.create(); }
      catch (error) { this.error = String(error); }
      this.busy = false;
      if (!this.error) this.close();
      cx.notify();
    });
  }

  async create() {
    const typed = this.text.trim(), name = slug(typed);
    if (!name) return "Type a jj workspace name.";
    if (this.list.some((w) => w.name === name)) return `There is already a jj workspace named ${name}: open it instead.`;
    const path = `${ROOT(this.userHome)}/${this.repo.name}/${name}`;
    // A bookmark of that name: the new working copy starts on it. Otherwise on @'s parents, like here.
    const bookmark = await jj(this.repo.top, ["--ignore-working-copy", "log", "--no-graph", "-r", `bookmarks(exact:${lit(typed)})`, "-T", '"x"'], this.on);
    const base = bookmark.ok && bookmark.out ? ["-r", lit(typed)] : [];
    const r = await jj(this.repo.top, ["workspace", "add", "--name", name, ...base, path], this.on, 600_000);
    if (!r.ok) return r.err || "jj workspace add failed.";
    // Unnamed: the space follows its folder and nests under the repo in the sidebar.
    run("space.new", { folder: path, machine: this.on });
    return "";
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((w) => !f || `${w.name} ${w.description} ${w.path}`.toLowerCase().includes(f));
  }

  open(w) {
    // Enter can reach both the input's submit and the key handler: act once.
    if (!w || this.opened || w.missing) return;
    this.opened = true;
    this.close();
    // Another workspace's ops leave this one stale; its shell would hit that first. Best effort.
    exec("jj", ["--no-pager", "workspace", "update-stale"], { cwd: w.path, on: this.on }).catch(() => {});
    const s = spaceOf(w.path, this.list, this.on, spaces(), panes());
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: w.path, machine: this.on });
  }

  async remove() {
    const w = this.self, s = this.space();
    if (!w || !this.repo.linked) return "This is the repository's main jj workspace.";
    // Terminals first: a shell in the folder would be left in a deleted directory.
    if (s) run("space.close", { id: s.id, confirmed: true });
    // From the main workspace: this one's folder is about to go.
    const r = await jj(this.repo.main, ["workspace", "remove", w.name], this.on, 600_000);
    return r.ok ? "" : r.err || "jj workspace remove failed.";
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (this.opening) {
      const n = this.shown().length;
      if (e.key === "enter") this.open(this.shown()[this.at]);
      else if ((e.key === "down" || e.key === "up") && n) this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && this.action === "remove") return this.go(cx);
  }

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces(), paneList = panes();
    const row = (w, i) => {
      const on = i === this.at;
      const there = spaceOf(w.path, all, this.on, spaceList, paneList);
      return v_flex().id(`ws-${i}`).flex_none().h(44).px(10).justify_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .when(Boolean(w.missing), (el) => el.opacity(0.6)).on_click(() => this.open(w))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_none().text_color(t.foreground).child(w.name))
          .child(div().flex_none().text_size(11).text_color(t.accent).child(w.change))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(w.description || "(no description)"))
          .when(w.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main")))
          .when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
          .when(Boolean(w.missing), (el) => el.child(div().flex_none().text_size(11).text_color(t.blocked).child("folder missing"))))
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(w.path, this.userHome ?? "")));
    };
    const count = rows.length === all.length ? `${all.length} jj workspaces` : `${rows.length}/${all.length} jj workspaces`;
    return v_flex().id("jj-workspace").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open jj workspace${r ? ` of ${r.name}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : "")))
      .when(r === undefined, (el) => el.child(div().text_color(t.muted).child("…")))
      .when(r === null, (el) => el.child(div().text_color(t.muted).child(this.error || `${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a jj repository.`)))
      .when(Boolean(r && this.list), (el) => el
        .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground))
        .child(div().relative().flex_1().min_h(0)
          .child(v_flex().id("ws-list").size_full().overflow_y_scroll().children(rows.map(row))
            .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No matching jj workspaces."))))
          .child(Scrollbar.vertical("ws-list").absolute().inset_0())))
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child("↑↓ choose · ↵ open · esc close"));
  }

  render() {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    const remove = this.action === "remove";
    const r = this.repo;
    const title = remove ? `Remove jj workspace ${this.self?.name ?? this.space()?.name ?? ""}?` : `New jj workspace${r ? ` of ${r.name}` : ""}`;
    const detail =
      r === undefined ? "…"
        : r === null ? `${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a jj repository.`
        : remove
          ? !r.linked ? "This is the repository's main jj workspace: it can't be removed."
            : `Closes the space and deletes ${tilde(r.top, this.userHome ?? "")}. Its edits are saved as a commit first; ignored files (.env, build output) are deleted.`
          : `A new space on a jj workspace in ${tilde(ROOT(this.userHome ?? ""), this.userHome ?? "")}/${r.name}/. Named after a local bookmark, its new change starts on it (the bookmark doesn't move); otherwise it starts from here.`;
    const blocked = !r || (remove && !r.linked);
    return v_flex().id("jj-workspace").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(!remove && !blocked, (el) => el.child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).gap(6)
        .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
        .child(this.busy ? "working…" : blocked ? "esc close" : remove ? "↵ remove · esc cancel" : "↵ create · esc cancel"));
  }
}
