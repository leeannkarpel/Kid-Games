/*
 * Background music for a game: one looping track, quieter while the voice talks.
 *
 *   <script src="/voice-clips.js"></script>
 *   <script src="/bg-music.js" data-src="/games/math-race/music/turbo-track.mp3"></script>
 *
 * The music starts on the first tap (browsers block sound before that). A small 🎵 button in the
 * bottom-left corner turns it on and off, and the choice is remembered on that device.
 * It gets quieter whenever a recorded voice clip or the device voice is speaking, and
 * pauses while the page is hidden.
 */
(function () {
  var script = document.currentScript;
  var SRC = script && script.getAttribute("data-src");
  if (!SRC) return;
  var VOLUME = parseFloat((script && script.getAttribute("data-volume")) || "0.32");
  var DUCKED = VOLUME * 0.35;
  var KEY = "mrmos-music";

  var on = true;
  try { on = localStorage.getItem(KEY) !== "off"; } catch (e) {}

  var ctx = null, gain = null, src = null, buffer = null, loading = null, started = false, ducked = false;

  function load() {
    if (!loading) {
      loading = fetch(SRC)
        .then(function (r) { if (!r.ok) throw new Error("music " + r.status); return r.arrayBuffer(); })
        .then(function (ab) { return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); }); })
        .then(function (b) { buffer = b; return b; })
        .catch(function () { loading = null; return null; });
    }
    return loading;
  }

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // On iPhones, let the music play even with the ringer switch off, like the voice clips do.
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    ctx = new AC();
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    return ctx;
  }

  function play() {
    if (!on || !ensureCtx()) return;
    if (ctx.state !== "running") ctx.resume();
    if (src) return;
    load().then(function (b) {
      if (!b || src || !on) return;
      src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(gain);
      src.start();
      var t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(ducked ? DUCKED : VOLUME, t + 1.5);   // gentle fade in
    });
  }

  function stop() {
    if (!src) return;
    var s = src, t = ctx.currentTime;
    src = null;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    try { s.stop(t + 0.35); } catch (e) {}
  }

  // Start on the first tap or key press.
  function firstGesture() {
    if (started) return;
    started = true;
    play();
  }
  ["pointerdown", "touchend", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, firstGesture, { capture: true, passive: true });
  });

  // Quieter while the voice talks.
  function talking() {
    var vc = window.VoiceClips;
    if (vc && vc.isPlaying && vc.isPlaying()) return true;
    try { if (window.speechSynthesis && speechSynthesis.speaking) return true; } catch (e) {}
    return false;
  }
  setInterval(function () {
    if (!src) return;
    var d = talking();
    if (d === ducked) return;
    ducked = d;
    var t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(d ? DUCKED : VOLUME, t, d ? 0.06 : 0.35);
  }, 100);

  // Pause while the tab or app is in the background.
  document.addEventListener("visibilitychange", function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (on && started) ctx.resume();
  });

  // The on/off button.
  function addButton() {
    var b = document.createElement("button");
    b.type = "button";
    b.id = "musicToggle";
    b.style.cssText = [
      "position:fixed", "left:max(10px, env(safe-area-inset-left))", "bottom:max(10px, env(safe-area-inset-bottom))",
      "z-index:2147483000", "width:38px", "height:38px", "border-radius:50%", "border:2px solid rgba(255,255,255,.7)",
      "background:rgba(0,0,0,.45)", "color:#fff", "font-size:18px", "line-height:1", "padding:0", "cursor:pointer",
      "display:flex", "align-items:center", "justify-content:center", "-webkit-tap-highlight-color:transparent"
    ].join(";");
    function render() {
      b.textContent = on ? "🎵" : "🔇";
      b.setAttribute("aria-label", on ? "Music on. Tap to turn the music off" : "Music off. Tap to turn the music on");
      b.style.opacity = on ? "0.9" : "0.6";
    }
    b.addEventListener("click", function () {
      on = !on;
      try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
      started = true;
      if (on) play(); else stop();
      render();
    });
    render();
    document.body.appendChild(b);
  }
  if (document.body) addButton();
  else document.addEventListener("DOMContentLoaded", addButton);

  window.BgMusic = {
    isOn: function () { return on; },
    play: play,
    stop: stop
  };
})();
