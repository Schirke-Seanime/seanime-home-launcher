/// <reference path="./plugin.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

// Home Launcher: a row of tiles on the Seanime home screen, one for each
// plugin page in the sidebar (Anime Diary, Season Guide, ...), so they're a
// click away from home. There's no API listing installed plugins, so it
// watches the sidebar's links to plugin pages: tiles come and go with them.
// Those links are then hidden from the sidebar, since the tiles replace them.

function init() {
  $ui.register((ctx) => {
    // The tiles for plugins with a known look; any other plugin page gets a
    // tile with its sidebar label and initial.
    const RAW = "https://raw.githubusercontent.com/Schirke/"
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
    return '<div class="tile" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '">' + icon +
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
      if (id) ctx.screen.navigateTo("/webview", { id })
    })

    // Plugin pages from the sidebar's links: /webview?id=<plugin id>.
    function update(links: any[]) {
      const seen: { [id: string]: boolean } = {}
      const out: any[] = []
      for (const a of (links || [])) {
        const href = String((a && a.attributes && a.attributes.href) || "")
        const m = /[?&]id=([^&#]+)/.exec(href)
        if (!m) continue
        // The router may write search values JSON-style: id=%22anime-diary%22.
        const id = decodeURIComponent(m[1]).replace(/^"|"$/g, "")
        if (seen[id]) continue
        seen[id] = true
        const k = KNOWN[id]
        // Elements carry their text as "text" (the type file says textContent).
        const label = String((a && (a.text || a.textContent)) || "").trim()
        out.push(k
          ? { id, name: k.name, tagline: k.tagline, icon: k.icon, order: k.order }
          : { id, name: label || id, tagline: "", icon: "", order: 100 })
      }
      out.sort((x, y) => (x.order - y.order) || x.name.localeCompare(y.name))
      tiles.set(out)
    }

    // The launcher stands in for the plugins' sidebar links, so they're
    // hidden. Only the link itself is styled, and only once, so hiding it
    // doesn't set off the observer again and again.
    function hide(links: any[]) {
      for (const a of (links || [])) {
        const style = String((a && a.attributes && a.attributes.style) || "")
        if (/display:\s*none/.test(style)) continue
        try { a.setStyle("display", "none") } catch (e) { console.error("Home Launcher: hide: " + e) }
      }
    }

    function found(links: any[]) {
      update(links)
      hide(links)
    }

    // The sidebar can be ready before this handler is listening for "ready",
    // so the observer starts right away too, again on "ready" and whenever
    // this tab becomes the main one, and the sidebar is asked directly every
    // couple of seconds until the first links turn up.
    const SELECTOR = 'a[href*="/webview?id="]'
    let stopObserving: any = null
    function watch() {
      try { if (stopObserving) stopObserving() } catch (e) { /* gone */ }
      const r: any = ctx.dom.observe(SELECTOR, found)
      stopObserving = r && r[0]
    }
    ctx.dom.onReady(watch)
    ctx.dom.onMainTabReady(watch)
    watch()
    let tries = 0
    const stopAsking = ctx.setInterval(() => {
      const have = tiles.get()
      if ((have && have.length) || ++tries > 15) { stopAsking(); return }
      ctx.dom.query(SELECTOR).then((links: any[]) => { if (links && links.length) found(links) })
    }, 2000)

  })
}
