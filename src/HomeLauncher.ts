/// <reference path="./plugin.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

// Home Launcher: a row of tiles on the Seanime home screen, one for each
// plugin page in the sidebar (Anime Diary, Season Guide, ...), so they're a
// click away from home. Which plugins are installed comes from Seanime's
// local server; other plugins' pages are picked up from the sidebar.
// Those links are then hidden from the sidebar, since the tiles replace them.
// A plugin that Seanime couldn't load (say, an update that needs its
// permissions approved again) gets a warning tile that opens Extensions.

function init() {
  $ui.register((ctx) => {
    // The tiles for plugins with a known look; any other plugin page gets a
    // tile with its sidebar label and initial.
    const RAW = "https://raw.githubusercontent.com/Schirke-Seanime/"
    const KNOWN: { [id: string]: { name: string, tagline: string, icon: string, order: number } } = {
      "what-to-watch": { name: "What to Watch", tagline: "Pick something for today", icon: RAW + "seanime-what-to-watch/main/src/icon.png", order: 1 },
      "anime-swipe": { name: "Anime Swipe", tagline: "Discover new anime", icon: RAW + "seanime-anime-swipe/main/src/icon.png", order: 2 },
      "season-guide": { name: "Season Guide", tagline: "This season, for you", icon: RAW + "seanime-season-guide/main/src/icon.png", order: 3 },
      "backlog": { name: "Backlog", tagline: "Worth going back to?", icon: RAW + "seanime-backlog/main/src/icon.png", order: 4 },
      "anime-diary": { name: "Anime Diary", tagline: "What you watched, day by day", icon: RAW + "seanime-anime-diary/main/src/icon.png", order: 5 },
    }

    const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  html { color-scheme: dark; background: transparent; }
  html, body { margin: 0; color: #ececf1; font: 14px/1.35 Inter, "Segoe UI", system-ui, sans-serif; background: transparent; }
  .row { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; padding: 4px 0 10px; }
  .tile { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px; cursor: pointer;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); transition: background .15s, transform .15s, border-color .15s; }
  .tile:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); transform: translateY(-1px); }
  .icon { width: 42px; height: 42px; border-radius: 11px; flex: none; object-fit: cover; }
  .letter { display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;
    background: linear-gradient(135deg, #5a5a6e, #34343f); color: #fff; }
  .name { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag { font-size: 12px; color: #9a9aa6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .text { min-width: 0; }
  .warn { border-color: rgba(255,180,60,.45); }
  .warn .icon { filter: grayscale(1) opacity(.6); }
  .warn .tag { color: #ffb43c; }
</style>
</head>
<body>
<div class="row" id="row"></div>
<script>
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function render(tiles) {
  var row = document.getElementById("row");
  row.innerHTML = (tiles || []).map(function (t) {
    var icon = t.icon ? '<img class="icon" src="' + esc(t.icon) + '" alt="">'
      : '<div class="icon letter">' + esc(String(t.name).charAt(0).toUpperCase()) + '</div>';
    return '<div class="tile' + (t.warn ? ' warn' : '') + '" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '">' + icon +
      '<div class="text"><div class="name">' + esc(t.name) + '</div>' + (t.tagline ? '<div class="tag">' + esc(t.tagline) + '</div>' : '') + '</div></div>';
  }).join("");
  row.style.display = tiles && tiles.length ? "" : "none";
}
document.addEventListener("click", function (ev) {
  var el = ev.target.closest ? ev.target.closest("[data-id]") : null;
  if (el) window.webview.send("open", { id: el.getAttribute("data-id") });
});
// This frame is sized to fit, so it has nothing to scroll: Chrome's
// middle-click autoscroll would get stuck in it and take the wheel with
// it. A middle click on the tiles does nothing instead.
document.addEventListener("mousedown", function (ev) { if (ev.button === 1) ev.preventDefault(); });
window.webview.on("tiles", render);
render([]);
</script>
</body>
</html>`

    const page = ctx.newWebview({
      slot: "after-home-screen-toolbar",
      fullWidth: true,
      autoHeight: true,
    })
    const tiles = ctx.state<any[] | null>(null)
    page.channel.sync("tiles", tiles)
    page.setContent(() => PAGE_HTML)

    page.channel.on("open", (p: any) => {
      const id = p && String(p.id || "")
      if (!id) return
      if (broken[id]) ctx.screen.navigateTo("/extensions")
      else ctx.screen.navigateTo("/webview", { id })
    })

    // Installed plugins from the local server (sidebar links can sit in the unopened "More" menu); null = use the sidebar.
    // A failed ask keeps the last good answer.
    const EXTENSIONS_API = "http://127.0.0.1:43211/api/v1/extensions/all"
    let installed: { [id: string]: boolean } | null = null
    // Plugins Seanime couldn't load: id -> name.
    let broken: { [id: string]: string } = {}
    async function loadInstalled() {
      try {
        const res = await fetch(EXTENSIONS_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ withUpdates: false }),
        })
        const j: any = await res.json()
        const d = j && j.data
        if (!d || !Array.isArray(d.extensions)) throw new Error("unexpected answer")
        const off: { [id: string]: boolean } = {}
        for (const e of (d.disabledExtensions || [])) if (e) off[typeof e === "string" ? e : e.id] = true
        const ids: { [id: string]: boolean } = {}
        for (const e of d.extensions) if (e && e.type === "plugin" && !off[e.id]) ids[e.id] = true
        const bad: { [id: string]: string } = {}
        for (const e of (d.invalidExtensions || [])) {
          const x = e && e.extension
          if (x && x.id && x.type === "plugin" && x.id !== "home-launcher" && !off[x.id]) bad[x.id] = String(x.name || x.id)
        }
        installed = ids
        broken = bad
      } catch (e) {
        console.error("Home Launcher: couldn't ask Seanime for the installed plugins: " + e)
      }
      rebuild()
      // The answer decides which sidebar links get hidden.
      refresh()
    }

    // Plugin pages seen in the sidebar this session.
    const pages: { [id: string]: string } = {}
    function update(links: any[]) {
      for (const a of (links || [])) {
        const id = linkId(a)
        if (!id) continue
        // Elements carry their text as "text" (the type file says textContent).
        const label = String((a && (a.text || a.textContent)) || "").trim()
        if (!pages[id] || label) pages[id] = label || id
      }
      rebuild()
    }

    // Known installed plugins first, then other plugin pages, then the ones
    // that failed to load. If nothing at all could be found, all known tiles
    // are shown rather than an empty row.
    let gaveUp = false
    let shown: { [id: string]: boolean } = {}
    function rebuild() {
      const out: any[] = []
      for (const id in KNOWN) {
        if (installed ? installed[id] : pages[id] !== undefined) {
          const k = KNOWN[id]
          out.push({ id, name: k.name, tagline: k.tagline, icon: k.icon, order: k.order })
        }
      }
      for (const id in pages) {
        if (!KNOWN[id] && !broken[id] && (!installed || installed[id])) out.push({ id, name: pages[id], tagline: "", icon: "", order: 100 })
      }
      const ok: { [id: string]: boolean } = {}
      for (const t of out) ok[t.id] = true
      for (const id in broken) {
        if (ok[id]) continue
        const k = KNOWN[id]
        out.push({ id, name: k ? k.name : broken[id], tagline: "Needs attention, open Extensions", icon: k ? k.icon : "", order: 200, warn: true })
      }
      if (!out.length && !installed && gaveUp) {
        for (const id in KNOWN) {
          const k = KNOWN[id]
          out.push({ id, name: k.name, tagline: k.tagline, icon: k.icon, order: k.order })
          ok[id] = true
        }
      }
      out.sort((x, y) => (x.order - y.order) || x.name.localeCompare(y.name))
      shown = ok
      tiles.set(out)
    }

    function linkId(a: any): string {
      const href = String((a && a.attributes && a.attributes.href) || "")
      const m = /[?&]id=([^&#]+)/.exec(href)
      // The router may write search values JSON-style: id=%22anime-diary%22.
      return m ? decodeURIComponent(m[1]).replace(/^"|"$/g, "") : ""
    }

    // The launcher stands in for the plugins' sidebar links, so they're
    // hidden, but only those with a working tile. Only the link itself is
    // styled, and only once, so hiding it doesn't set off the observer again
    // and again.
    function hide(links: any[]) {
      for (const a of (links || [])) {
        const id = linkId(a)
        if (!shown[id] || broken[id]) continue
        const style = String((a && a.attributes && a.attributes.style) || "")
        if (/display:\s*none/.test(style)) continue
        try { a.setStyle("display", "none") } catch (e) { console.error("Home Launcher: hide: " + e) }
      }
    }

    const SELECTOR = 'a[href*="/webview?id="]'

    // The tiles are always rebuilt from all the sidebar's plugin links. The
    // observer only reports the links that were added or changed (opening a
    // plugin page changes just its own link), so it's only a cue to ask for
    // the full set; cues close together make one request.
    let refreshing = false
    function refresh() {
      if (refreshing) return
      refreshing = true
      ctx.setTimeout(() => {
        ctx.dom.query(SELECTOR).then((links: any[]) => {
          refreshing = false
          if (!links) return
          update(links)
          hide(links)
        }, () => { refreshing = false })
      }, 250)
    }

    function changed(links: any[]) {
      hide(links)
      refresh()
    }

    // The sidebar can be ready before this handler is listening for "ready",
    // so the observer starts right away too, again on "ready" and whenever
    // this tab becomes the main one, and the sidebar is asked directly every
    // couple of seconds until the first links turn up.
    let stopObserving: any = null
    function watch() {
      try { if (stopObserving) stopObserving() } catch (e) { /* gone */ }
      const r: any = ctx.dom.observe(SELECTOR, changed)
      stopObserving = r && r[0]
    }
    ctx.dom.onReady(watch)
    ctx.dom.onMainTabReady(watch)
    watch()
    let tries = 0
    const stopAsking = ctx.setInterval(() => {
      const have = tiles.get()
      if (have && have.length && installed) { stopAsking(); return }
      if (++tries > 15) { stopAsking(); gaveUp = true; rebuild(); return }
      refresh()
    }, 2000)
    loadInstalled()
    // Back on the home screen: recount, so a removed plugin's tile goes too.
    page.onMount(() => { loadInstalled(); refresh() })

  })
}
