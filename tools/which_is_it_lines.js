// Builds mr-mos-games/games/which-is-it/audio/manifest.json: every line "Which Is It?" can speak, in both languages.
// It loads the game headlessly and calls its own allLines(), which walks every question (all categories,
// normal and tricky, every target) instead of sampling, plus feedback, candy cards, turns and wins.
//
// Usage: node tools/which_is_it_lines.js           # write the manifest
//        node tools/which_is_it_lines.js --count   # just print counts and characters
//
// "text" is exactly what the game passes to speak(); "say" is what is sent to ElevenLabs when the
// spelling needs help (letter names, letter sounds). Files are named by a slug + hash of the text,
// so a file only changes when its line changes.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const GAME = path.resolve(__dirname, "../mr-mos-games/games/which-is-it");
const OUT = path.join(GAME, "audio/manifest.json");
// Two narrator sets. "story" is the original storyteller; "spooky" is the spooky narrator, picked in the game's Voice menu.
// The spooky takes get a short delivery direction in front (eleven_v4 reads [..] as direction, not words).
const SETS = {
  story:  { dir: "",          voices: { en: "2OEeJcYw2f3bWMzzjVMU", es: "lP1VZ61RLnDtOoz41b3D" },   // Clara (EN), Jade (ES)
            names: { en: "Clara - Children's Storyteller", es: "Jade" } },
  spooky: { dir: "spooky/",   voices: { en: "DUhzmIGFwXJ752SvgcCj", es: "3mmJ2Z5SLZ9OkeZZcv5p" },   // Daria (EN), Óscar (ES)
            names: { en: "Daria - Funny Scary Witch", es: "Oscar - Narrator, fluid pitch, easy to listen" },
            tag: { en: "[spooky, slow, clear] ", es: "[misterioso, lento, claro] " } }
};

// Letter sounds, spelled so the voice makes the sound instead of saying letter names.
const SOUND_TTS = {
  en: { A: "aa", B: "buh", C: "kuh", D: "duh", E: "eh", F: "fffff", G: "guh", H: "huh", I: "ih", J: "juh", L: "lllll",
        M: "mmmmm", N: "nnnnn", O: "ah", P: "puh", R: "rrrrr", S: "sssss", T: "tuh", U: "uh", V: "vvvvv", W: "wuh", Z: "zzzzz" },
  es: { A: "a", B: "ba", C: "ca", D: "da", E: "e", F: "fffff", G: "ga", I: "i", J: "ja", L: "lllll", M: "mmmmm", N: "nnnnn",
        O: "o", P: "pa", R: "rrrrr", S: "sssss", T: "ta", U: "u", Y: "ya" }
};
const SOUND_SHOWN = { // what the game shows/says for each sound (from SOUNDS in index.html)
  en: { A: "aah", B: "buh", C: "kuh", D: "duh", E: "eh", F: "fff", G: "guh", H: "huh", I: "ih", J: "juh", L: "lll", M: "mmm", N: "nnn",
        O: "aw", P: "puh", R: "rrr", S: "sss", T: "tuh", U: "uh", V: "vvv", W: "wuh", Z: "zzz" },
  es: { A: "a", B: "ba", C: "ca", D: "da", E: "e", F: "fff", G: "ga", I: "i", J: "ja", L: "lll", M: "mmm", N: "nnn", O: "o", P: "pa",
        R: "rrr", S: "sss", T: "ta", U: "u", Y: "ya" }
};

function ttsText(l, lang) {
  const t = l.t;
  if (lang === "en" && l.cat === "letters") {
    const L = `"${t}"`;
    if (l.kind === "question") return l.hard ? `Which one is little ${L}?` : `Which one is the letter ${L}?`;
    return l.hard ? `It's little ${L}!` : `It's the letter ${L}!`;
  }
  if (lang === "es" && l.cat === "letters" && !l.hard && t === "D") {
    // "...la letra de" at the end of a line came out sounding like "be"; a capital D is read as "de".
    return l.text.replace(/letra de([?!])$/, "letra D$1");
  }
  if (l.cat === "sounds") {
    const shown = SOUND_SHOWN[lang][t], spoken = SOUND_TTS[lang][t];
    if (!shown) throw new Error("no sound for " + t);
    if (l.kind === "reveal") {
      // "It's the letter bee, buh!" -> say the letter clearly, pause, then the sound
      return lang === "en" ? `It's the letter "${t}"... ${spoken}!` : l.text.replace(new RegExp(`, ${shown}!$`), `... ${spoken}!`);
    }
    return l.text.replace(`... ${shown}`, `... ${spoken}`);
  }
  return null;
}

function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.join(GAME, "index.html"));
  const lines = await page.evaluate(() => ({ en: window.__wii.allLines("en"), es: window.__wii.allLines("es") }));
  await browser.close();

  const out = [];
  for (const set of Object.keys(SETS)) for (const lang of ["en", "es"]) {
    const S = SETS[set];
    for (const l of lines[lang]) {
      const hash = crypto.createHash("sha1").update(lang + "|" + l.text).digest("hex").slice(0, 6);
      const e = { text: l.text, lang, group: l.group, file: `${S.dir}${lang}/${slug(l.text) || "line"}-${hash}.mp3`, voice_id: S.voices[lang] };
      if (set !== "story") e.set = set;
      let s = ttsText(l, lang);
      if (S.tag) s = S.tag[lang] + (s || l.text);
      if (s && s !== l.text) e.say = s;
      e.kind = l.kind; if (l.cat) { e.cat = l.cat; e.hard = l.hard; }
      out.push(e);
    }
  }
  const files = new Set(out.map(e => e.file));
  if (files.size !== out.length) throw new Error("duplicate file names");

  const chars = a => a.reduce((n, e) => n + (e.say || e.text).length, 0);
  for (const set of Object.keys(SETS)) for (const lang of ["en", "es"]) {
    const a = out.filter(e => e.lang === lang && (e.set || "story") === set);
    console.log(`${set} ${lang}: ${a.length} lines, ${chars(a)} characters`);
  }
  console.log(`total: ${out.length} lines, ${chars(out)} characters`);
  if (process.argv.includes("--count")) return;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ voices: SETS.story.names, spooky_voices: SETS.spooky.names, model: "eleven_v4",
    music: { file: "music.mp3", source: "ElevenLabs Music, flow 2Rc7rDYaC2UtIvOpdE4w, generation u0yv4XM2hjiK5boWPpVU (take A)",
             loop: "first 48.0 s (20 bars at 100 BPM), 0.3 s crossfade at the seam, loudness -18 LUFS" },
    lines: out }, null, 1) + "\n");
  console.log("wrote", path.relative(process.cwd(), OUT));
})();
