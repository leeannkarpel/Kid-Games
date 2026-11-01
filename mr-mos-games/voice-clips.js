/*
 * Recorded voice clips, with the device's own speech as a fallback.
 * Shared by every game on this site. No build step: include with
 *   <script src="/voice-clips.js"></script>
 *
 * Each game keeps its clips in games/<slug>/voice/ with a manifest.json:
 *   { "lines": [ { "text": "Ready, set, go!", "lang": "en", "file": "ready-set-go.mp3" }, ... ] }
 *
 *   const vo = VoiceClips.create({ base: "/games/math-race/voice/" });
 *   vo.play(["Player 1", "3 plus 4?"], {
 *     lang: "en",                       // default language for string parts
 *     fallback: part => promiseThatResolvesWhenDeviceSpeechEnds(part.text, part.lang),
 *     onstart, onend                    // optional
 *   });
 *
 * Parts are played one after another. A part with no clip (or a clip that
 * fails to load or play) is handed to fallback(), so custom typed names and
 * any line without a recording still get spoken by the device voice.
 */
(function () {
  "use strict";
  var SILENT = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAABgAAAykAWlpaWlpaWlpaWlpaWlpaWnt7e3t7e3t7e3t7e3t7e3t7nJycnJycnJycnJycnJycnL29vb29vb29vb29vb29vb293t7e3t7e3t7e3t7e3t7e3t7/////////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQCowAAAAAAAAMpso+sIAAAAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxKQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEowAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";
  var LOAD_TIMEOUT = 5000;     // give up on a clip that takes longer than this to download
  var PLAY_TIMEOUT = 15000;    // safety net in case "ended" never fires

  // One shared <audio> element for the whole page. iPhones only let a page play
  // sound from an element that was first started by a tap, so it's "unlocked"
  // with a short silent clip on the first touch. Media elements also keep
  // playing with the ringer switch off, like the device voice does.
  var el = null, unlocked = false;
  function audioEl() {
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      el.setAttribute("playsinline", "");
    }
    return el;
  }
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    var a = audioEl();
    if (a.src && !a.paused) return;
    try {
      a.src = SILENT;
      var p = a.play();
      if (p && p.catch) p.catch(function () { unlocked = false; });
    } catch (e) { unlocked = false; }
  }
  ["pointerdown", "touchend", "mousedown", "keydown"].forEach(function (ev) {
    try { window.addEventListener(ev, unlock, { capture: true, passive: true }); } catch (e) {}
  });

  function withTimeout(p, ms, val) {
    return Promise.race([p, new Promise(function (res) { setTimeout(function () { res(val); }, ms); })]);
  }

  // Every player shares the one element, so only one line plays at a time.
  var active = null;   // the player currently using the element

  function create(opts) {
    opts = opts || {};
    var base = opts.base || "voice/";
    if (base.charAt(base.length - 1) !== "/") base += "/";
    var map = null;
    var ready = withTimeout(
      fetch(base + "manifest.json", { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) {
          map = {};
          var lines = (m && m.lines) || [];
          for (var i = 0; i < lines.length; i++) {
            var l = lines[i], url = base + l.file;
            map[(l.lang || "*") + "|" + l.text] = url;
            if (!map["*|" + l.text]) map["*|" + l.text] = url;
          }
        })
        .catch(function () { map = map || {}; }),
      LOAD_TIMEOUT
    ).then(function () { map = map || {}; });

    var blobs = {};       // url -> Promise<objectURL|null>
    function load(url) {
      if (!blobs[url]) {
        blobs[url] = withTimeout(
          fetch(url)
            .then(function (r) { if (!r.ok) throw new Error("missing " + url); return r.blob(); })
            .then(function (b) { return URL.createObjectURL(b); }),
          LOAD_TIMEOUT, null
        ).catch(function () { return null; }).then(function (u) {
          if (!u) delete blobs[url];   // try again next time
          return u;
        });
      }
      return blobs[url];
    }

    var token = 0, finishCurrent = null;
    var api = {
      speaking: false,
      ready: ready,
      urlFor: function (text, lang) {
        if (!map) return null;
        return map[(lang || "*") + "|" + text] || map["*|" + text] || null;
      },
      has: function (text, lang) { return !!api.urlFor(text, lang); },
      // Warm the cache so a line starts without a download pause.
      prefetch: function (texts, lang) {
        return ready.then(function () {
          (texts || []).forEach(function (t) {
            var u = api.urlFor(typeof t === "string" ? t : t.text, (t && t.lang) || lang);
            if (u) load(u);
          });
        });
      },
      stop: function () {
        token++;
        api.speaking = false;
        if (finishCurrent) finishCurrent(false);
        if (active === api && el) { try { el.pause(); } catch (e) {} }
      },
      // Returns a promise: true if every part finished, false if it was stopped.
      play: function (parts, o) {
        o = o || {};
        api.stop();
        var my = ++token;
        if (!Array.isArray(parts)) parts = [parts];
        parts = parts
          .map(function (p) { return typeof p === "string" ? { text: p, lang: o.lang } : { text: p.text, lang: p.lang || o.lang }; })
          .filter(function (p) { return p.text != null && String(p.text).trim() !== ""; });
        api.speaking = true;
        return ready.then(function () {
          if (my !== token) return false;
          var urls = parts.map(function (p) { return api.urlFor(p.text, p.lang); });
          return Promise.all(urls.map(function (u) { return u ? load(u) : null; })).then(function (objs) {
            if (my !== token) return false;
            if (o.onstart) { try { o.onstart(); } catch (e) {} }
            var i = 0;
            function next() {
              if (my !== token) return Promise.resolve(false);
              if (i >= parts.length) return Promise.resolve(true);
              var part = parts[i], obj = objs[i];
              i++;
              var played = obj ? playUrl(obj, my, o.rate) : Promise.resolve(false);
              return played.then(function (ok) {
                if (my !== token) return false;
                if (!ok && o.fallback) {
                  var f;
                  try { f = o.fallback(part); } catch (e) { f = null; }
                  return Promise.resolve(f).then(next, next);
                }
                return next();
              });
            }
            return next().then(function (done) {
              if (my === token) {
                api.speaking = false;
                if (o.onend) { try { o.onend(); } catch (e) {} }
              }
              return done;
            });
          });
        });
      }
    };

    function playUrl(obj, my, rate) {
      return new Promise(function (resolve) {
        if (my !== token) return resolve(false);
        var a = audioEl(), done = false, timer = null;
        if (active && active !== api) active.stop();
        active = api;
        function fin(ok) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          a.onended = a.onerror = null;
          if (finishCurrent === fin) finishCurrent = null;
          resolve(ok);
        }
        finishCurrent = fin;
        a.onended = function () { fin(true); };
        a.onerror = function () { fin(false); };
        try {
          a.src = obj;
          a.playbackRate = rate || 1;
          if ("preservesPitch" in a) a.preservesPitch = !(rate && rate !== 1);
          var p = a.play();
          if (p && p.catch) p.catch(function () { fin(false); });
        } catch (e) { fin(false); }
        timer = setTimeout(function () { fin(true); }, PLAY_TIMEOUT);
      });
    }
    return api;
  }

  window.VoiceClips = {
    create: create,
    // True while a recorded clip is playing (background music uses this to get quieter).
    isPlaying: function () { return !!(el && !el.paused && !el.ended && el.src !== SILENT); },
    RECORDED: "recorded",              // value used for the "Recorded voice" picker option
    LABEL: "Recorded voice",
    LABEL_ES: "Voz grabada"
  };
})();
