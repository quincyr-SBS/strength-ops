# Project notes for Claude

## Project shape

- React + Vite + plain JS (no TypeScript). React 19, Vite 8.
- Two source files do most of the work:
  - `src/App.jsx` — single-file React app (program tab, readiness tab, nutrition tab, coach AI tab, log tab).
  - `src/program.js` — pure helpers (no React, no DOM): gate evaluator, block + step state, calibration, deload, date math, load scaling. Imported by `App.jsx`.
- Persistence: `localStorage` only. Keys are `sqb_*` — App-owned (`sqb_step_state`, `sqb_current_block`, `sqb_readiness_history`, `sqb_deload_state`) plus three in the Oura hook (`sqb_rhr_baseline`, `sqb_oura_cache`, `sqb_oura_cache_ts`).
- Oura sync is a separate hook (`src/hooks/useOuraSync.js`) hitting a Val.town proxy. Cache 30 min.
- No backend other than the Netlify function for Oura.

## Tests

- `npm test` runs `node --test src/program.test.js` (built-in test runner, no vitest / jest).
- Tests cover pure helpers in `program.js`. UI is not unit-tested.
- New pure-helper changes get tests. Add a regression test for any bug a reviewer catches.

## Lint

- `npm run lint` is ESLint 9 with flat config.
- There's a known baseline of **6 pre-existing errors** unrelated to current work:
  - `netlify/functions/oura-sync.js`: `exports` not defined (CJS in an ESM project)
  - `src/hooks/useOuraSync.js`: two empty `catch{}` blocks
  - `src/App.jsx`: unused `showSaveMeal`/`setShowSaveMeal`, unused `e` in a catch
- New work should not introduce additional lint errors. Compare with `npm run lint 2>&1 | grep "error\b" | wc -l` (should stay at 6).

## Build

- `npm run build` is Vite. Single chunk. Check the latest `npm run build` output for current bundle size — it grows with each feature.

## Program model conventions

- **Block A → B → C → D** open-ended macro cycle. Each exercise has `block: "A"|"B"|...` and an optional `replaces: "exId"` to supersede a prior-block movement.
- **Progression is gate-based, not calendar-based.** Each exercise has `progression: [step, ...]` where each step has `{ sets, reps, load, loadNum, rpe, gate }`. Use the `S(...)` and `G.*` builders for readability.
- Gate types: `RPE_BELOW` (accessories), `RPE_PAIN` (heavy compounds — includes back + shoulder pain), `PAIN_FREE_WEEKS` (phase transitions), `null` (maintenance).
- `RPE_PAIN` and `PAIN_FREE_WEEKS` require at least one HARD-tier session in the qualifying window before clearing.
- **Tier resolution priority:** `RECOVERY` (Oura readiness < 70) > `DELOAD` (active) > `HARD`/`MODERATE` (Oura). Recovery always wins.
- **`mult` per tier:** HARD 1.0, MODERATE 0.8, DELOAD 0.85, RECOVERY 0. DELOAD also cuts working sets to 50% (`effectiveSets()` helper) — small load drop, bigger volume drop is the classic deload protocol.
- Sessions logged during DELOAD or RECOVERY are excluded from gate counts by design.

## Date math

- All ISO date parsing in `program.js` appends `"T00:00:00Z"` to be UTC-invariant. Don't introduce local-TZ parsing — it produces off-by-one bugs in positive-offset timezones.

## `scaleLoad` regex

- Only scales numbers immediately followed by `"lb"` (regex: `/(\d+)(?=\s*lb)/g`). Time/count tokens (`"× 30s"`, `"4 directions"`) in the load string must NOT scale. If you add a new load string with a time/count, verify scaling under MODERATE.

## PR workflow

- One feature branch (`claude/strength-training-program-C7erZ`) is used for all work. Each round of changes opens a fresh PR against `master`.
- PRs are merge-committed by the user (history shows merge commits on `master`, e.g. `be09e3c`). After merge, the same feature branch continues; new commits land on the next PR.
- Pre-commit/lint hooks aren't configured. Run `npm test`, `npm run lint`, `npm run build` manually before pushing.
- Confirm before any destructive git op (force-push, reset --hard, branch -D) per the standard Claude Code rules.

## GitHub @copilot interaction

When the user comments `@copilot apply changes...` on a PR where I (Claude) have **already addressed the feedback**, GitHub's Copilot SWE agent may produce duplicate work and introduce its own bugs (see PR #7: it added a dead `loadBanner` variable, then opened a follow-up commit to remove it).

**Mitigation:** before the user pings `@copilot`, or as soon as I see one, post a comment on the PR like:

> Already fixed in `<sha>` — see thread replies above. No @copilot action needed.

This gives Copilot a clear signal to no-op.

If I missed it and Copilot has already pushed a "Potential fix", pull the branch, verify lint/tests/build are still green, and only act if there's actual regression. Copilot tends to self-clean after one round.

## Don't do

- Don't reintroduce a calendar-driven deload schedule. The 8-week `wb()` model was replaced for a reason.
- Don't add explicit `tier:"HARD"` to legacy test fixtures — `(h.tier ?? "HARD")` is intentional for backwards compatibility with un-tiered history.
- Don't use `window.confirm()` for impactful actions. Use the inline confirm pattern (see `showBlockConfirm` in `App.jsx` for the prior art).
- Don't put numbers in `load` strings except for actual weights (in `lb`). Reps live in `reps`, RPE in `rpe`, anything else in `cue` or `note`.
