// Headless check of every game at phone sizes: console errors, and that recorded clips actually play.
// Usage: node tools/test_games.js   (serves both site folders itself)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".mp3": "audio/mpeg" };
function serve(dir, port) {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(dir, p);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end("nf"); }
      rsp.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    }).listen(port, () => res(s));
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
async function click(page, sel) {
  const el = await page.$(sel);
  if (!el) return false;
  if (await el.isVisible()) { try { await el.click({ timeout: 3000 }); return true; } catch (e) {} }
  await page.evaluate(s => document.querySelector(s) && document.querySelector(s).click(), sel);
  return true;
}
async function clickAny(page, sels) { for (const s of sels) if (await click(page, s)) return s; return null; }

// Each game: a short real play-through with taps.
const GAMES = [
  { site: "mr-mos-games", slug: "math-race", run: async p => {
      await click(p, "#go"); await wait(4000);
      await click(p, "#problem"); await wait(3000);
      await click(p, "#voiceTest"); await wait(2500);
  } },
  { site: "mr-mos-games", slug: "ramp-rally", run: async p => {
      await click(p, "#voiceTest"); await wait(3500);
      await click(p, "#startBtn"); await wait(4000);
      await click(p, ".ans"); await wait(4000);
      await click(p, "#hear"); await wait(3000);
  } },
  { site: "mr-mos-games", slug: "bilingual-bingo", run: async p => {
      await click(p, '.mode[data-mode="numbers"]'); await wait(1500);
      await click(p, "#callBtn"); await wait(5000);
      await click(p, "#enBox"); await wait(2000);
      await click(p, '[data-test="es"]'); await wait(3000);
  } },
  { site: "mr-mos-games", slug: "bone-builder", run: async p => {
      await click(p, "#voiceTest"); await wait(3000);
      await click(p, "#go"); await wait(6000);
      await click(p, "#againBtn"); await wait(5000);
  } },
  { site: "melly-mos-games", slug: "animal-peekaboo", run: async p => {
      await click(p, "#play"); await wait(2500);
      for (let i = 0; i < 2; i++) {
        await clickAny(p, ["#stage .house", "#stage [role=button]", "#stage button"]); await wait(5000);
      }
      await click(p, '[data-test="es"]'); await wait(3000);
  } },
  { site: "melly-mos-games", slug: "light-up-taps", run: async p => {
      await click(p, "#play"); await wait(2500);
      const box = await p.evaluate(() => { const r = document.body.getBoundingClientRect(); return [r.width / 2, r.height / 2]; });
      await p.mouse.click(box[0], box[1]); await wait(2500);
      await click(p, '[data-test="en"]'); await wait(3500);
  } },
  { site: "melly-mos-games", slug: "dance-like-me", run: async p => {
      await click(p, "#startBtn"); await wait(9000);
      await click(p, "#stopBtn"); await wait(1500);
      await click(p, "#testVoice"); await wait(3000);
  } },
  { site: "melly-mos-games", slug: "kitty-says", run: async p => {
      await click(p, "#startBtn"); await wait(16000);
      await click(p, '.song[data-i="2"]'); await wait(2000);
      await click(p, "#stopBtn"); await wait(3000);
      await click(p, "#testVoice"); await wait(3000);
  } },
];

const SIZES = [["portrait", 390, 844], ["landscape", 844, 390]];

(async () => {
  const servers = { "mr-mos-games": [await serve(path.join(ROOT, "mr-mos-games"), 8801), 8801],
                    "melly-mos-games": [await serve(path.join(ROOT, "melly-mos-games"), 8802), 8802] };
  const browser = await chromium.launch();
  let bad = 0;
  for (const g of GAMES) for (const [label, w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [], clipReq = [], clipBad = [];
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
    page.on("response", r => { if (/\/voice\/.+\.mp3$/.test(r.url())) { clipReq.push(r.url().split("/voice/")[1]); if (r.status() !== 200) clipBad.push(r.status() + " " + r.url()); } });
    await page.addInitScript(() => {
      window.__played = []; window.__ended = 0; window.__device = [];
      const op = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.src && !this.src.startsWith("data:")) { window.__played.push(this.src); this.addEventListener("ended", () => window.__ended++, { once: true }); }
        return op.apply(this, arguments);
      };
      if (window.speechSynthesis) {
        const os = speechSynthesis.speak.bind(speechSynthesis);
        speechSynthesis.speak = u => { window.__device.push(u.text); return os(u); };
      }
    });
    const url = `http://localhost:${servers[g.site][1]}/games/${g.slug}/`;
    await page.goto(url, { waitUntil: "load" });
    await wait(800);
    let runErr = null;
    try { await g.run(page); } catch (e) { runErr = e.message; }
    const r = await page.evaluate(() => ({ played: window.__played.length, ended: window.__ended, device: window.__device.slice(0, 6),
      sel: [...document.querySelectorAll("select")].map(s => s.options[s.selectedIndex] && s.options[s.selectedIndex].text).filter(Boolean) }));
    const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const ok = !errors.length && !runErr && r.played > 0 && r.ended > 0 && !clipBad.length;
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"} ${g.slug} ${label}: clips fetched ${clipReq.length}, played ${r.played}, finished ${r.ended}; device-voice lines ${r.device.length}${r.device.length ? " " + JSON.stringify(r.device) : ""}; pickers ${JSON.stringify(r.sel)}${hOverflow ? "; (page scrolls sideways)" : ""}`);
    for (const e of errors.concat(clipBad, runErr ? ["run: " + runErr] : [])) console.log("     " + e);
    await ctx.close();
  }
  await browser.close();
  Object.values(servers).forEach(([s]) => s.close());
  process.exit(bad ? 1 : 0);
})();
