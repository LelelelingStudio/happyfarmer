# Happy Farmer / 爱种地的农民

A calm, slow-paced farm management game built as a pure static web app. English is the default language; Chinese can be switched at any time from the in-game settings.

**Version:** 1.1.0

**Age rating:** 6+ / 6岁以上

**Web build:** https://happyfarmer.game.leleleling.site/

**Runtime:** modern browsers, no build step, no backend required for the core game

## About the game

Start with one small plot of land. Dig, plant, water, harvest, process and sell your produce, then use the earnings to unlock more crops, workshops, skins and achievements. There is no stamina system, no forced quests, no daily check-in and no in-app purchase.

### Core loop

- Dig plots with a short timing mini-game
- Plant from 1,000 crops across 10 families
- Water, wait and harvest
- Process goods in a 9-level workshop with 1,893 recipes
- Sell to 5 merchants, use the consignment market or join auctions
- Unlock 50 skins and 150 achievements

### Systems

- Weather and four seasons affect growth
- Random events: treasure, thieves, disease and travelling merchants
- 100 shop items unlocked in batches
- Offline local saves with export / import
- Optional leaderboard unlocked at level 5 (opt-in; needs network)
- Keyboard shortcuts: Space/Enter = next day, S = save, Esc = close dialog

## Play locally

No build or install is needed. Either:

1. Open `index.html` directly in a browser, or
2. Serve the folder with the bundled dev server:

```bash
node tools/dev-server.js          # http://127.0.0.1:8765/
node tools/dev-server.js 8080     # custom port
```

Then visit `http://127.0.0.1:8765/`.

> Do **not** use `python3 -m http.server` for this project. It accepts only a
> handful of concurrent connections and resets the rest; the game loads 60+
> scripts and 190+ images at once, so the loading screen would sit at 0%.
> If you need a Python server, use a threaded one with a large backlog.

The first launch shows a short loading progress bar, an Ages 6+ notice and the legal consent gate. You must confirm before starting a new game, continuing or importing a save. After confirmation the choice is remembered in `localStorage`.

## Project structure

```text
index.html               Game entry and start screen
legal.html               Three legal documents, selected by ?doc=1/2/3
languagecontrol.js       Locale resolution and dynamic language-pack loading
css/                     All styles, including legal.css
js/
  core/                  State, saving, codec, loading and game logic
  systems/               Weather, events, audio, leaderboard, etc.
  ui/                    Dialogs, HUD, settings, consent gate, etc.
  main.js                Bootstrap and start-screen flow
langdata/
  ch/                    Chinese UI, messages and legal documents
  en/                    English UI, messages and legal documents
  constants.js           Global version and storage constants
assets/                  Images, audio and fonts
tools/                   Manifest and i18n check scripts
RELEASE.md               multi-platform publishing checklist
intro-main.en.txt        English store description
```

## Languages

New players start in English. Players who already chose Chinese before upgrading keep their preference. Switch languages at any time in Settings.

Language packs are plain JavaScript objects:

- `langdata/{ch,en}/ui-*.js` — interface strings
- `langdata/{ch,en}/messages-*.js` — dynamic notifications and errors
- `langdata/{ch,en}/documents-*.js` — legal document content

Run `node tools/check_i18n.js` to check for missing or mismatched keys.

## Legal documents

Three public legal pages ship with the game:

| Document | URL |
| --- | --- |
| User Agreement (EULA, including the gameplay guide) | https://happyfarmer.game.leleleling.site/legal.html?doc=1&lang=en |
| Privacy Policy | https://happyfarmer.game.leleleling.site/legal.html?doc=2&lang=en |
| Terms of Service | https://happyfarmer.game.leleleling.site/legal.html?doc=3&lang=en |

Add `&lang=zh` for Chinese or `&lang=en` for English. Invalid `doc` values fall back to the EULA. These pages are static and readable offline.

See `RELEASE.md` for the published HTTPS links, the age-rating statement and the lelele Game Rules compliance check.

## Release

`happy-farmer-v1.1.0.zip` is the platform-neutral static release package. `index.html` is at the archive root, so it can be uploaded to any static host or web-game portal. Do not commit release ZIPs; they are ignored by Git.

Before publishing, follow every checklist item in `RELEASE.md`, especially the three legal links and the leaderboard CORS check.

## Credits

Published by leleleling Studio · Lelelegame.

All rights reserved. The game source is provided for reference and deployment of this title; no software license is granted by this repository.
