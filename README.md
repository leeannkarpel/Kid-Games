# Kid Games

This repo is the **source for both game sites**. Each Vercel project builds from its own folder here.
There's no build step: the folders hold plain static files.

| Site | Live at | Folder |
|---|---|---|
| Mr. Mo's Games | https://mrmos.games | [`mr-mos-games/`](mr-mos-games) |
| Melly Mo's Games | https://mellymos.games | [`melly-mos-games/`](melly-mos-games) |

Each game lives at `<site>/games/<slug>/index.html`, and each site's home page lists its games in the `GAMES` array in `<site>/index.html`.

## Making changes

**All updates go through this repo.** Please don't upload files to Vercel directly. A direct upload gets overwritten by the next push, and the change is lost from the repo.

- Pushing to `main` deploys **both sites to production**, so every commit on `main` must leave both sites working.
- For anything bigger than a small fix, work on a branch first. Vercel builds a preview link for it, which you can check before merging.

## Recorded voices

The games speak with recorded ElevenLabs clips. If a clip is missing or won't load, they fall back to the device's own speech. For example, a custom name typed by a player is spoken by the device voice.

- `<site>/voice-clips.js` is the shared player that every game loads.
- `<site>/games/<slug>/voice/` holds the game's clips, plus `manifest.json`, which maps each spoken text to its mp3 file.
- Every game's voice picker defaults to **Recorded voice**. A grown-up can still switch it to one of the device's voices.

### Adding or changing a spoken line

1. Add the line to the game's `voice/manifest.json` with its `text`, `lang`, `voice_id` and `file`. Add `say` if the text sent to ElevenLabs needs to differ from `text`.
2. Run `python3 tools/generate_voice.py --count` to see how many characters will be used.
3. Run `python3 tools/generate_voice.py` to generate the clips. It needs `ELEVENLABS_API_KEY` and skips clips that already exist. To redo a clip, delete its mp3 and run it again.
4. Run `node tools/test_games.js` to check every game headlessly at phone portrait and landscape sizes.

Voices used:

| Games | Voice | Voice ID |
|---|---|---|
| Math Race, Ramp Rally | Cody | `9XfYMbJVZqPHaQtYnTAO` |
| Bone Builder and Bingo English lines | Emma | `oClOrzqamOXmtcB8iqTj` |
| All Spanish lines | Kate 7 | `U9tZtg3uJtVgXPkvosWR` |
| Animal Peekaboo, Light-Up Taps and Kitty Taps English lines | Tilly | `4gnXtzQIIeGuC5hxActn` |
| Dance Like Me, Kitty Says | Lulu Lollipop | `ocZQ262SsZb9RIxcQBOj` |
| Which Is It? English lines (Storyteller) | Clara (Children's Storyteller) | `2OEeJcYw2f3bWMzzjVMU` |
| Which Is It? Spanish lines (Storyteller) | Jade | `lP1VZ61RLnDtOoz41b3D` |
| Which Is It? English lines (Spooky narrator) | Daria (Funny Scary Witch) | `DUhzmIGFwXJ752SvgcCj` |
| Which Is It? Spanish lines (Spooky narrator) | Óscar | `3mmJ2Z5SLZ9OkeZZcv5p` |

The clips use the `eleven_v4` model.

## Sound effects

Some games also have real sound effects made with ElevenLabs sound generation, such as the meows in Kitty Taps. They live in `<site>/games/<slug>/sounds/` with a `manifest.json` that lists each file and the prompt that made it. Run `python3 tools/generate_sounds.py` to make any that are missing (delete an mp3 to redo it).

## Background music

Mr. Mo's games each loop one instrumental ElevenLabs Music track, from `mr-mos-games/games/<slug>/music/`. The track's `manifest.json` lists each file and the prompt that made it.

- `mr-mos-games/bg-music.js` is the shared player. A game turns it on with `<script src="/bg-music.js" data-src="/games/<slug>/music/<file>.mp3"></script>`, placed after `voice-clips.js`.
- The music starts on the first tap. It gets quieter while the voice talks, and pauses when the page is hidden.
- A 🎵 button in the bottom-left corner turns the music off or on, and each device remembers the choice.
- Run `python3 tools/generate_music.py` to make any tracks that are missing (delete an mp3 to redo it).

### Which Is It? Haunted House

This game is self-contained (it doesn't load `voice-clips.js` or `bg-music.js`). Its audio lives in `mr-mos-games/games/which-is-it/audio/`: `en/` and `es/` (the Storyteller), `spooky/en/` and `spooky/es/` (the Spooky narrator), `music.mp3` and `manifest.json`. The 🎵 music button is in the game's top bar.

The Voice menu on the setup screen picks the narrator: Spooky narrator (the default) or Storyteller. Every line is recorded in both. If a spooky clip is missing, the game plays the Storyteller's clip instead. The spooky takes start with a short delivery direction, `[spooky, slow, clear]` or `[misterioso, lento, claro]`. The model doesn't read it aloud.

"How spooky?" on the setup screen controls the spooky extras:
- **Scare level:** Cozy, Spooky or Extra spooky.
- **Walk on:** the board's spaces, as candy, tombstones, pumpkins or skulls. The colors and the rules stay the same.
- **Spooky things:** one button per effect.

The choices are saved on the device in `localStorage` under `wii-spooky`. The extras live at the end of `index.html`, in the "SPOOKY EXTRAS" block. They hear about the game through window events (`spooky:board`, `spooky:right`, `spooky:passage`, `spooky:win`). Their sounds are made in the browser with Web Audio, so there are no extra files. That includes the "Monster groove" music, which plays in place of `music.mp3` when it's switched on.

1. `node tools/which_is_it_lines.js` rebuilds the manifest from the game's own code. It lists every line the game can say, in both languages.
2. `python3 tools/which_is_it_audio.py --count`, then `python3 tools/which_is_it_audio.py`, makes any missing clips. Each clip is trimmed, loudness-matched (-16 LUFS) and saved as mono 64 kbps MP3.
3. `node tools/test_which_is_it.js` plays the game headlessly. It checks that every line plays its own clip, at phone portrait and landscape, in both languages.

`tools/` sits outside both site folders, so it is never deployed.
