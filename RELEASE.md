# Happy Farmer v1.1.0 — release checklist

## 1. Package

Use `happy-farmer-v1.2.0.zip` in this folder.

The ZIP is platform-neutral. `index.html` is at the archive root, so it can be uploaded to any static host or web-game portal that accepts a ZIP or a plain folder. The game uses only relative paths and works in an iframe subpath.

Included:
- `index.html`, `legal.html`
- `css/`, `js/`, `langdata/`, `assets/`
- `languagecontrol.js`

Excluded:
- `tools/`, `CNAME`, `surge-parallel.sh`
- hidden files, `.DS_Store`, local release notes and source descriptions

## 2. Age rating and legal documents

- Age rating shown at start: **Ages 6+ / 6岁以上**
- Start screen requires an explicit checkbox before New Game, Continue or Import.
- Consent is version-bound (`farm_legal_consent_v1_1_0`) and persisted in localStorage.

**Web build:** https://happyfarmer.game.leleleling.site/

The three public legal pages are live and verified (v1.1.0, 2026-11-22):

| Document | URL |
|---|---|
| User Agreement (EULA, gameplay guide merged in) | https://happyfarmer.game.leleleling.site/legal.html?doc=1&lang=en |
| Privacy Policy | https://happyfarmer.game.leleleling.site/legal.html?doc=2&lang=en |
| Terms of Service | https://happyfarmer.game.leleleling.site/legal.html?doc=3&lang=en |

Each page also supports `&lang=zh` for Chinese. All three are readable without login.

The original in-game gameplay guide has been merged into the EULA. The lelele Game Rules page (`https://game.leleleling.site/game_rules.html`) was used as the compliance checklist only and is deliberately not shown inside the game.

## 3. lelele Game Rules self-check (v5.0.0)

- [x] 4.6 Three legal agreements: provided as three public HTTPS direct links above.
- [x] 2.2 Honest age rating: Ages 6+ based on content (no violence, chat, UGC or purchases).
- [x] 2.3 Pure front-end static game, no build step, no severe known bugs.
- [x] 2.4 No unauthorized personal data collection; leaderboard is opt-in and anonymizable.
- [x] 4.4 Offline play: core game runs from local files; only the optional leaderboard needs network.
- [x] 5.x Content rules: no prohibited content, no ads, no third-party feedback scripts.

## 4. What changed in v1.1.0

- English is the default for new players; Chinese remains switchable. Completed i18n coverage adds the consent block, age notice, legal entry labels, avatar errors and second-hand item display.
- Removed the Tally feedback script.
- Unified all versions to `1.1.0`, including `GAME_VERSION`, the loading screen, every resource cache-busting parameter and `saveVersion`.
- Added a `1.0.3 → 1.1.0` save migration with default-value merging; SAVE_KEY and the `HF1:` codec are unchanged so old saves still load.
- Added a real loading progress bar, meaningful preload stages and consistent timeout fallbacks.
- Added keyboard shortcuts documented in the EULA: Space/Enter = next day, S = save, Esc = close dialog.

## 5. Fixed issues (24 verified, 1 accepted risk)

Fixed and browser-verified:
1. Save version comparison used string `>`; now semantic.
2. Save migration chain completed for 1.0.3 → 1.1.0.
3. All scattered version strings unified.
4. Leaderboard "me" marker used the wrong field.
5. New-save `stats` fields added and old saves backfilled.
6. Audio toggle ignored its own `isSoundOn()` state.
7. Data-load timeout left the start screen locked.
8. Loader hard-stop released the loader but not the start screen.
9. Progress bar stalled at 5% and released too early.
10. Loader stage weight ratios were ignored.
11. Dead `_preloadAudio()` removed; only metadata is preloaded.
12. Loader timeout constants were inconsistent and `languagecontrol.js` had no cache-busting parameter.
13. Keyboard shortcuts promised by the rules were missing; implemented.
14. ESC closed stacked modals incorrectly and leaked keydown listeners.
15. Modal focus was not trapped or restored.
16. `window.confirm` was overridden by an async shim that always returned false.
17. Tooltips never worked on touch devices; long-press added.
18. Empty i18n values wiped static HTML labels.
19. English UI still showed the Chinese second-hand suffix.
20. Duplicate `section`/`emptyState` keys in both UI packs removed.
21. Leaderboard avatar HTML allowed arbitrary markup; now whitelisted and escaped.
22. Start-screen weather/season were hardcoded Chinese.
23. Avatar upload errors were hardcoded Chinese; now coded and localized.
24. Legal entry points were inconsistent; three links now open `legal.html?doc=1/2/3`.

Accepted risk (needs backend work, not changed here):
- The leaderboard signature salt is still present in client code. It is an intentional lightweight deterrent; moving signing server-side requires a Cloudflare Worker change.

## 6. Pre-upload verification record

Local static server: `python3 -m http.server 8765` at the project root. Browser: agent-browser, audio never enabled.

- Loading screen visible and progresses through stages; start screen appears only after assets are ready. Screenshots: `/tmp/ghf-v110-load-a.png`, `/tmp/ghf-v110-load-b.png`.
- New player starts in English; the 6+ notice and consent checkbox are visible.
- Clicking New Game without consent shows the warning and does not start.
- Checking the box persists `farm_legal_consent_v1_1_0`.
- `legal.html?doc=1/2/3` and `?lang=zh` all render the correct document. Screenshot: `/tmp/ghf-legal-en2.png`.
- English documents contain no Chinese characters; gameplay guide lives in the EULA.

## 7. Before publishing to any platform

- [x] Web build URL confirmed as `https://happyfarmer.game.leleleling.site/`.
- [x] Legal URLs finalized with the canonical domain and added to the store page description.
- [ ] Set the platform-appropriate age rating to "Everyone 6+" or equivalent.
- [ ] Verify the leaderboard CORS from each target platform origin. Failure is non-fatal: the game stays playable.
- [ ] Confirm the three legal links are reachable from a logged-out browser.
- [ ] Use `happyfarmer.png` as the cover image and `intro-main.en.txt` as the English description.
