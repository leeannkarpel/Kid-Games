// Headless test for "Which Is It? Haunted House".
// Usage: node tools/test_which_is_it.js [--quick]
//
//  1. Manifest: every line the game can speak (from the game's own allLines()) has a clip, and every clip file loads.
//  2. Real play at phone portrait and landscape, in English and Spanish, 2 players and vs the robot, one category at a
//     time plus "all": taps answers (right and wrong), checks each spoken line played its own clip
//     (the clip mapped to that exact text), never fell back to the device voice, music started and ducked,
//     and then plays to the win screen. Fails on any console error.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");

const SITE = path.resolve(__dirname, "../mr-mos-games");
const GAME = "/games/which-is-it/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".mp3": "audio/mpeg" };
const QUICK = process.argv.includes("--quick");
const wait = ms => new Promise(r => setTimeout(r, ms));

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

async function until(page, fn, arg, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await wait(150); }
  return false;
}

(async () => {
  const server = await serve(SITE, 8811);
  const base = `http://localhost:8811${GAME}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const manifest = JSON.parse(fs.readFileSync(path.join(SITE, GAME, "audio/manifest.json"), "utf8"));
  const byKey = {}; manifest.lines.forEach(l => { byKey[l.lang + "|" + l.text] = l.file; });
  let bad = 0; const fail = m => { bad++; console.log("   FAIL " + m); };

  // ---------- 1. manifest coverage ----------
  {
    const page = await browser.newPage();
    await page.goto(base);
    const all = await page.evaluate(() => ({ en: window.__wii.allLines("en"), es: window.__wii.allLines("es") }));
    let n = 0, missing = 0, files = 0;
    for (const lang of ["en", "es"]) for (const l of all[lang]) {
      n++;
      const f = byKey[lang + "|" + l.text];
      if (!f) { missing++; fail(`no clip in manifest for ${lang}: ${l.text}`); continue; }
      if (!fs.existsSync(path.join(SITE, GAME, "audio", f))) { missing++; fail(`clip file missing: ${f}`); }
      else files++;
    }
    const extra = manifest.lines.filter(l => !all[l.lang].some(x => x.text === l.text));
    extra.forEach(l => fail(`manifest line the game never says: ${l.lang} ${l.text}`));
    console.log(`${missing || extra.length ? "FAIL" : "PASS"} manifest: ${n} spoken lines, ${files} clips on disk, ${missing} missing, ${extra.length} unused`);
    await page.close();
  }

  // ---------- 2. real play ----------
  const SIZES = [["portrait", 390, 844], ["landscape", 844, 390]];
  const RUNS = [];
  for (const [label, w, h] of SIZES) for (const lang of ["en", "es"]) {
    RUNS.push({ label, w, h, lang, mode: "two", cats: ["shapes", "letters", "sounds", "numbers", "colors"], turns: QUICK ? 4 : 8, win: true });
    RUNS.push({ label, w, h, lang, mode: "robot", cats: ["shapes", "letters", "sounds", "numbers", "colors"], turns: QUICK ? 4 : 6, win: true });
    if (!QUICK) for (const c of ["shapes", "letters", "sounds", "numbers", "colors"])
      RUNS.push({ label, w, h, lang, mode: label === "portrait" ? "solo" : "two", cats: [c], turns: 8, win: false });
  }

  // one complete game, start to the Ghost Party, no shortcuts (2 players, every answer right)
  RUNS.push({ label: "portrait", w: 390, h: 844, lang: "en", mode: "two", cats: ["shapes", "letters", "sounds", "numbers", "colors"], turns: 80, realWin: true, win: true });
  RUNS.push({ label: "landscape", w: 844, h: 390, lang: "es", mode: "robot", cats: ["shapes", "letters", "sounds", "numbers", "colors"], turns: 120, realWin: true, win: true });

  for (const r of RUNS) {
    const ctx = await browser.newContext({ viewport: { width: r.w, height: r.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [], clipBad = [], badBefore = bad;
    page.on("pageerror", e => errors.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
    page.on("response", x => { if (/\/audio\/.+\.mp3$/.test(x.url()) && x.status() !== 200) clipBad.push(x.status() + " " + x.url()); });
    await page.addInitScript(cfg => {
      localStorage.setItem("wii-lang", JSON.stringify(cfg.lang)); localStorage.setItem("wii-mode", JSON.stringify(cfg.mode));
      localStorage.setItem("wii-cats", JSON.stringify(cfg.cats)); localStorage.setItem("wii-names", JSON.stringify(["Ana", "Leo"]));
      window.__device = [];
      if (window.speechSynthesis) { const os = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = u => { window.__device.push(u.text); return os(u); }; }
    }, r);
    await page.goto(base, { waitUntil: "load" });
    await wait(400);
    await page.tap("#startBtn");
    const name = `${r.label} ${r.lang} ${r.mode} [${r.cats.length > 1 ? "all" : r.cats[0]}]`;
    const sawLoader = await until(page, () => !document.getElementById("loadWrap").hidden, null, 3000);
    if (!(await until(page, () => window.__wii.G && window.__wii.G.q, null, 20000))) { fail(name + ": first turn never started"); }
    const seen = { normal: new Set(), hard: new Set() };
    let rights = 0, wrongs = 0;
    for (let k = 0; k < r.turns; k++) {
      if (r.realWin && await page.evaluate(() => !document.getElementById("win").hidden)) break;
      const ok = await until(page, () => { const G = window.__wii.G; return (G && G.q && !G.answered && !G.busy) || !document.getElementById("win").hidden; }, null, 25000);
      if (r.realWin && await page.evaluate(() => !document.getElementById("win").hidden)) break;
      if (!ok) { fail(name + ": turn " + k + " never became ready"); break; }
      const st = await page.evaluate(() => { const G = window.__wii.G; return { robot: !!G.players[G.turn].robot, cat: G.q.cat, hard: G.q.hard, answer: G.q.answer, n: G.q.items.length }; });
      seen[st.hard ? "hard" : "normal"].add(st.cat);
      // let the question finish speaking
      await until(page, () => !document.getElementById("hearBtn").classList.contains("on"), null, 300);
      await until(page, () => document.getElementById("hearBtn").classList.contains("on"), null, 3000);
      await until(page, () => !document.getElementById("hearBtn").classList.contains("on"), null, 10000);
      if (st.robot) { await until(page, () => window.__wii.G.answered, null, 15000); continue; }
      const right = r.realWin || k % 3 !== 1;
      const pickI = right ? st.answer : (st.answer + 1) % st.n;
      await page.tap(`#opts .opt[data-i="${pickI}"]`);
      right ? rights++ : wrongs++;
      await until(page, () => window.__wii.G.answered && !document.getElementById("hearBtn").classList.contains("on"), null, 3000);
    }
    // music should be running and ducked at some point
    const mu = await page.evaluate(() => ({ playing: !!window.__wii.music.src, on: window.__wii.music.on }));
    if (r.win) {
      // jump the current player close to the end and win with a right answer
      if (!r.realWin) {
        await until(page, () => { const G = window.__wii.G; return G && G.q && !G.answered && !G.busy && !G.players[G.turn].robot; }, null, 30000);
        await page.evaluate(() => { const G = window.__wii.G; G.players[G.turn].pos = 62; G.card.dest = 63; });
        await until(page, () => !document.getElementById("hearBtn").classList.contains("on"), null, 10000);
        const a = await page.evaluate(() => window.__wii.G.q.answer);
        await page.tap(`#opts .opt[data-i="${a}"]`);
      }
      if (!(await until(page, () => !document.getElementById("win").hidden, null, 20000))) fail(name + ": win screen never showed");
      await wait(1200);
      await until(page, () => !document.getElementById("hearBtn").classList.contains("on") && window.__wii.voiceLog.some(x => /Party|fiesta/.test(x.text)), null, 9000);
      const title = await page.textContent("#winTitle");
      if (r.realWin) console.log(`     full game: ${await page.evaluate(() => window.__wii.G.players.map(p => p.piece + "@" + p.pos).join(" "))}, title "${title}"`);
      if (!(r.mode === "robot" ? /Ana|Robot/ : /Ana|Leo/).test(title)) fail(name + ": win title should show the typed name, got " + title);
    }
    const res = await page.evaluate(() => ({ log: window.__wii.voiceLog.slice(), device: window.__device.slice(),
      overflow: document.documentElement.scrollWidth > innerWidth + 1, lang: document.documentElement.lang }));
    // every spoken part must have played the clip mapped to that exact text, in the game's language
    let wrongClip = 0, fallback = 0;
    for (const e of res.log) {
      if (!e.file) { fallback++; fail(`${name}: device voice used for "${e.text}"`); continue; }
      if (e.lang !== r.lang) { wrongClip++; fail(`${name}: ${e.lang} line in ${r.lang} game: ${e.text}`); }
      if (byKey[e.lang + "|" + e.text] !== e.file) { wrongClip++; fail(`${name}: "${e.text}" played ${e.file}`); }
    }
    const turnLines = res.log.filter(e => /turn!|¡Turno/.test(e.text)).map(e => e.text);
    if (r.mode !== "solo" && !turnLines.length) fail(name + ": no character turn announcement");
    if (r.mode === "robot" && !turnLines.some(t => /Robot|robot/.test(t))) fail(name + ": robot's turn never announced");
    if (res.device.length) fail(name + ": device voice spoke " + JSON.stringify(res.device.slice(0, 3)));
    if (!mu.playing) fail(name + ": music not playing");
    if (res.overflow) fail(name + ": page scrolls sideways");
    errors.concat(clipBad).forEach(e => fail(name + ": " + e));
    const okRun = bad === badBefore && !errors.length && !clipBad.length && !wrongClip && !fallback && !res.device.length && mu.playing;
    console.log(`${okRun ? "PASS" : "FAIL"} ${name}: ${res.log.length} lines played from clips, ${rights} right / ${wrongs} wrong taps, ` +
      `normal ${[...seen.normal].join(",") || "-"} | tricky ${[...seen.hard].join(",") || "-"}; loader ${sawLoader ? "shown" : "not seen"}` +
      (turnLines.length ? `; e.g. ${JSON.stringify(turnLines[0])}` : ""));
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(bad ? `\n${bad} problem(s)` : "\nall good");
  process.exit(bad ? 1 : 0);
})();
