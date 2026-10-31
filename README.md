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
| Math Race, Ramp Rally | Mister Mouse | `iHiL14jSTiWXy4nzDtbq` |
| Bone Builder and Bingo English lines | Emma | `oClOrzqamOXmtcB8iqTj` |
| All Spanish lines | Kate 7 | `U9tZtg3uJtVgXPkvosWR` |
| Animal Peekaboo, Light-Up Taps and Kitty Taps English lines | Tilly | `4gnXtzQIIeGuC5hxActn` |
| Dance Like Me, Kitty Says | Lulu Lollipop | `ocZQ262SsZb9RIxcQBOj` |

The clips use the `eleven_v4` model.

## Sound effects

Some games also have real sound effects made with ElevenLabs sound generation, such as the meows in Kitty Taps. They live in `<site>/games/<slug>/sounds/` with a `manifest.json` that lists each file and the prompt that made it. Run `python3 tools/generate_sounds.py` to make any that are missing (delete an mp3 to redo it).

`tools/` sits outside both site folders, so it is never deployed.
