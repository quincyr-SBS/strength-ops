import { test } from "node:test";
import assert from "node:assert/strict";
import {
  G, S,
  evaluateGate,
  isoWeekKey,
  evaluateDeloadTriggers,
  getStepState,
  findExerciseById,
  isBlockTransitionReady,
  getVisibleExercises,
  getLockedPreview,
  scaleLoad,
  seekStepByLoad,
  applyCalibration,
  addDays,
  daysBetween,
  getActiveDeload,
  startDeload,
  endDeload,
  archiveExpiredDeload,
  weeksSinceLastDeload,
  DELOAD_DURATION_DAYS,
} from "./program.js";

// ─────────────────────────────────────────────────────────────────────────────
// evaluateGate — RPE_BELOW
// ─────────────────────────────────────────────────────────────────────────────
test("RPE_BELOW: clears when last N sessions all ≤ rpe", () => {
  const r = evaluateGate(G.rpe(7, 2), [
    { completed:true, topRPE:6.5 },
    { completed:true, topRPE:7   },
  ]);
  assert.equal(r.cleared, true);
  assert.equal(r.progress, "2/2");
});

test("RPE_BELOW: a single high-RPE session breaks the streak", () => {
  const r = evaluateGate(G.rpe(7, 2), [
    { completed:true, topRPE:6.5 },
    { completed:true, topRPE:8   },
  ]);
  assert.equal(r.cleared, false);
  assert.equal(r.progress, "1/2");
});

test("RPE_BELOW: not enough sessions does not clear", () => {
  const r = evaluateGate(G.rpe(7, 2), [{ completed:true, topRPE:6 }]);
  assert.equal(r.cleared, false);
});

test("RPE_BELOW: only completed sessions count", () => {
  const r = evaluateGate(G.rpe(7, 2), [
    { completed:false, topRPE:6 },
    { completed:true,  topRPE:6 },
    { completed:true,  topRPE:7 },
  ]);
  assert.equal(r.cleared, true);
});

test("RPE_BELOW: missing topRPE is treated as fail", () => {
  const r = evaluateGate(G.rpe(7, 2), [
    { completed:true },
    { completed:true, topRPE:6 },
  ]);
  assert.equal(r.cleared, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateGate — RPE_PAIN
// ─────────────────────────────────────────────────────────────────────────────
test("RPE_PAIN: pain spike on a session breaks the streak", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:7, painBack:3, painShoulder:0, tier:"HARD" },
    { completed:true, topRPE:7, painBack:1, painShoulder:0, tier:"HARD" },
  ]);
  assert.equal(r.cleared, false);
});

test("RPE_PAIN: clears when both RPE and pain stay under thresholds (with HARD)", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:7, painBack:1, painShoulder:0, tier:"HARD" },
    { completed:true, topRPE:7, painBack:2, painShoulder:1, tier:"HARD" },
  ]);
  assert.equal(r.cleared, true);
});

test("RPE_PAIN: shoulder pain alone breaks the gate", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:7, painBack:0, painShoulder:5, tier:"HARD" },
    { completed:true, topRPE:7, painBack:0, painShoulder:0, tier:"HARD" },
  ]);
  assert.equal(r.cleared, false);
});

test("RPE_PAIN: MODERATE-only sessions do not clear; gate awaits HARD confirmation", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:6, painBack:1, painShoulder:0, tier:"MODERATE" },
    { completed:true, topRPE:6, painBack:1, painShoulder:0, tier:"MODERATE" },
  ]);
  assert.equal(r.cleared, false);
  assert.match(r.progress, /awaiting HARD-tier confirmation/);
});

test("RPE_PAIN: at least one HARD session in the window unlocks the gate", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:6, painBack:1, painShoulder:0, tier:"MODERATE" },
    { completed:true, topRPE:7, painBack:1, painShoulder:0, tier:"HARD"     },
  ]);
  assert.equal(r.cleared, true);
});

test("RPE_PAIN: legacy entries with no tier are treated as HARD (backwards compat)", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:7, painBack:1, painShoulder:0 },
    { completed:true, topRPE:7, painBack:1, painShoulder:0 },
  ]);
  assert.equal(r.cleared, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateGate — PAIN_FREE_WEEKS
// ─────────────────────────────────────────────────────────────────────────────
test("PAIN_FREE_WEEKS: clears when distinct pain-free ISO weeks ≥ target (legacy entries treated as HARD)", () => {
  const r = evaluateGate(G.weeks(3, 2), [
    { completed:true, date:"2026-04-06", painBack:1, painShoulder:0 },
    { completed:true, date:"2026-04-13", painBack:0, painShoulder:1 },
    { completed:true, date:"2026-04-20", painBack:2, painShoulder:0 },
  ]);
  assert.equal(r.cleared, true);
});

test("PAIN_FREE_WEEKS: MODERATE-only weeks await HARD confirmation", () => {
  const r = evaluateGate(G.weeks(2, 2), [
    { completed:true, date:"2026-04-06", painBack:0, painShoulder:0, tier:"MODERATE" },
    { completed:true, date:"2026-04-13", painBack:0, painShoulder:0, tier:"MODERATE" },
  ]);
  assert.equal(r.cleared, false);
  assert.match(r.progress, /awaiting HARD-tier confirmation/);
});

test("PAIN_FREE_WEEKS: any HARD session inside the qualifying window unlocks the gate", () => {
  const r = evaluateGate(G.weeks(2, 2), [
    { completed:true, date:"2026-04-06", painBack:0, painShoulder:0, tier:"MODERATE" },
    { completed:true, date:"2026-04-13", painBack:0, painShoulder:0, tier:"HARD"     },
  ]);
  assert.equal(r.cleared, true);
});

test("PAIN_FREE_WEEKS: stale HARD outside the recent window does NOT clear", () => {
  // 5 pain-free weeks; gate wants 2. Only the OLDEST week had HARD.
  // The qualifying window is the 2 most recent weeks — both MODERATE.
  // Gate must NOT clear (otherwise old HARD history "carries" forever).
  const r = evaluateGate(G.weeks(2, 2), [
    { completed:true, date:"2026-03-02", painBack:0, painShoulder:0, tier:"HARD"     },
    { completed:true, date:"2026-03-09", painBack:0, painShoulder:0, tier:"MODERATE" },
    { completed:true, date:"2026-03-16", painBack:0, painShoulder:0, tier:"MODERATE" },
    { completed:true, date:"2026-03-23", painBack:0, painShoulder:0, tier:"MODERATE" },
    { completed:true, date:"2026-03-30", painBack:0, painShoulder:0, tier:"MODERATE" },
  ]);
  assert.equal(r.cleared, false);
  assert.match(r.progress, /awaiting HARD-tier confirmation in window/);
});

test("PAIN_FREE_WEEKS: HARD anywhere in the recent window clears", () => {
  // gate wants 3 weeks. Most recent 3 are MOD/HARD/MOD → HARD is in window.
  const r = evaluateGate(G.weeks(3, 2), [
    { completed:true, date:"2026-03-02", painBack:0, painShoulder:0, tier:"HARD"     },
    { completed:true, date:"2026-03-09", painBack:0, painShoulder:0, tier:"MODERATE" },
    { completed:true, date:"2026-03-16", painBack:0, painShoulder:0, tier:"HARD"     },
    { completed:true, date:"2026-03-23", painBack:0, painShoulder:0, tier:"MODERATE" },
  ]);
  assert.equal(r.cleared, true);
});

test("PAIN_FREE_WEEKS: same-week sessions count once", () => {
  const r = evaluateGate(G.weeks(3, 2), [
    { completed:true, date:"2026-04-06", painBack:1, painShoulder:0 },
    { completed:true, date:"2026-04-07", painBack:0, painShoulder:0 },
    { completed:true, date:"2026-04-08", painBack:0, painShoulder:0 },
  ]);
  assert.equal(r.cleared, false);
  assert.equal(r.progress, "1/3");
});

test("PAIN_FREE_WEEKS: a painful week is excluded entirely", () => {
  const r = evaluateGate(G.weeks(2, 2), [
    { completed:true, date:"2026-04-06", painBack:5, painShoulder:0 },
    { completed:true, date:"2026-04-13", painBack:0, painShoulder:0 },
  ]);
  assert.equal(r.cleared, false);
  assert.equal(r.progress, "1/2");
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateGate — edge cases
// ─────────────────────────────────────────────────────────────────────────────
test("null gate (maintenance) never clears", () => {
  const r = evaluateGate(null, [{ completed:true, topRPE:5 }]);
  assert.equal(r.cleared, false);
  assert.match(r.note, /maintenance/);
});

test("unknown gate type returns un-cleared", () => {
  const r = evaluateGate({ type:"BOGUS" }, []);
  assert.equal(r.cleared, false);
});

test("empty history never clears", () => {
  assert.equal(evaluateGate(G.rpe(8, 1), []).cleared,           false);
  assert.equal(evaluateGate(G.rpePain(8, 5, 1), []).cleared,    false);
  assert.equal(evaluateGate(G.weeks(1, 5), []).cleared,         false);
});

// ─────────────────────────────────────────────────────────────────────────────
// isoWeekKey
// ─────────────────────────────────────────────────────────────────────────────
test("isoWeekKey: deterministic for known dates", () => {
  assert.equal(isoWeekKey("2026-01-01"), "2026-W01");
  // Mid-year Monday
  assert.equal(isoWeekKey("2026-04-06"), "2026-W15");
});

test("isoWeekKey: same week for adjacent days", () => {
  assert.equal(isoWeekKey("2026-04-06"), isoWeekKey("2026-04-08"));
});

test("isoWeekKey: empty/invalid input returns empty string", () => {
  assert.equal(isoWeekKey(""), "");
  assert.equal(isoWeekKey(undefined), "");
  assert.equal(isoWeekKey("not-a-date"), "");
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateDeloadTriggers
// ─────────────────────────────────────────────────────────────────────────────
test("deload: 4 consecutive days <70 readiness fires", () => {
  const h = Array.from({length:4}, (_, i) => ({
    date:`2026-04-0${i+1}`, readiness:65, hrv:50, hrv7day:50, rhr:60, rhrBaseline:55,
  }));
  const t = evaluateDeloadTriggers(h);
  assert.ok(t.some(s => /Readiness <70/.test(s)));
});

test("deload: 3 days <70 does not fire", () => {
  const h = Array.from({length:3}, () => ({ readiness:65, hrv:50, hrv7day:50 }));
  assert.deepEqual(evaluateDeloadTriggers(h), []);
});

test("deload: HRV ↓ 3+ ms × 3 days fires", () => {
  const h = Array.from({length:3}, () => ({ readiness:80, hrv:45, hrv7day:50 }));
  const t = evaluateDeloadTriggers(h);
  assert.ok(t.some(s => /HRV/.test(s)));
});

test("deload: a single recovered day breaks the HRV streak", () => {
  const h = [
    { readiness:80, hrv:45, hrv7day:50 },
    { readiness:80, hrv:50, hrv7day:50 }, // recovered
    { readiness:80, hrv:45, hrv7day:50 },
  ];
  assert.deepEqual(evaluateDeloadTriggers(h), []);
});

test("deload: empty history returns no triggers", () => {
  assert.deepEqual(evaluateDeloadTriggers([]), []);
  assert.deepEqual(evaluateDeloadTriggers(undefined), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// getVisibleExercises / getLockedPreview
// ─────────────────────────────────────────────────────────────────────────────
const sampleDay = [
  { id:"a1", block:"A" },
  { id:"a2", block:"A" },
  { id:"b1", block:"B", replaces:"a1" },
  { id:"b2", block:"B" },
  { id:"c1", block:"C" },
];

test("visible: in Block A, only Block A exercises show", () => {
  const v = getVisibleExercises(sampleDay, "A").map(e => e.id);
  assert.deepEqual(v, ["a1", "a2"]);
});

test("visible: in Block B, replaced Block A exercises hide", () => {
  const v = getVisibleExercises(sampleDay, "B").map(e => e.id);
  assert.deepEqual(v.sort(), ["a2", "b1", "b2"]);
});

test("visible: in Block C, B-replacements still hide A", () => {
  const v = getVisibleExercises(sampleDay, "C").map(e => e.id);
  // a1 still hidden by b1, a2 still visible (no replacement), all B/C visible
  assert.ok(!v.includes("a1"));
  assert.ok(v.includes("a2"));
  assert.ok(v.includes("b1"));
  assert.ok(v.includes("b2"));
  assert.ok(v.includes("c1"));
});

test("locked: shows only the next block", () => {
  assert.deepEqual(getLockedPreview(sampleDay, "A").map(e=>e.id).sort(), ["b1","b2"]);
  assert.deepEqual(getLockedPreview(sampleDay, "B").map(e=>e.id), ["c1"]);
  assert.deepEqual(getLockedPreview(sampleDay, "C").map(e=>e.id), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// isBlockTransitionReady
// ─────────────────────────────────────────────────────────────────────────────
function makeProgram() {
  return {
    MON: { exercises: [
      { id:"x", block:"A", progression:[ S(3,5,"100",100,"7", G.rpe(7, 2)) ] },
      { id:"y", block:"A", progression:[ S(3,5,"100",100,"7", G.rpe(7, 2)), S(3,5,"110",110,"7", G.weeks(2, 2)) ] },
    ]},
  };
}

test("transition: false when an anchor is not at final step", () => {
  const program = makeProgram();
  const stepState = {
    x: { stepIdx:0, history:[
      { stepIdx:0, completed:true, topRPE:6 },
      { stepIdx:0, completed:true, topRPE:6 },
    ]},
    y: { stepIdx:0, history:[] },  // not at final step
  };
  assert.equal(isBlockTransitionReady(stepState, program, ["x","y"]), false);
});

test("transition: false when final-step gate not cleared", () => {
  const program = makeProgram();
  const stepState = {
    x: { stepIdx:0, history:[
      { stepIdx:0, completed:true, topRPE:6 },
      { stepIdx:0, completed:true, topRPE:6 },
    ]},
    y: { stepIdx:1, history:[
      { stepIdx:1, date:"2026-04-06", completed:true, painBack:0, painShoulder:0 },
      // only one distinct week — gate.weeks=2 → not clear
    ]},
  };
  assert.equal(isBlockTransitionReady(stepState, program, ["x","y"]), false);
});

test("transition: true when all anchors clear final-step gate", () => {
  const program = makeProgram();
  const stepState = {
    x: { stepIdx:0, history:[
      { stepIdx:0, completed:true, topRPE:6 },
      { stepIdx:0, completed:true, topRPE:6 },
    ]},
    y: { stepIdx:1, history:[
      { stepIdx:1, date:"2026-04-06", completed:true, painBack:0, painShoulder:0 },
      { stepIdx:1, date:"2026-04-13", completed:true, painBack:1, painShoulder:0 },
    ]},
  };
  assert.equal(isBlockTransitionReady(stepState, program, ["x","y"]), true);
});

test("transition: empty anchor list returns false (hides advance button by design)", () => {
  assert.equal(isBlockTransitionReady({}, makeProgram(), []), false);
});

test("transition: missing exercise in program is treated as not-ready", () => {
  assert.equal(isBlockTransitionReady({}, makeProgram(), ["does_not_exist"]), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// getStepState / findExerciseById
// ─────────────────────────────────────────────────────────────────────────────
test("getStepState: returns default for unseen exercise", () => {
  const st = getStepState({}, "new_ex");
  assert.equal(st.stepIdx, 0);
  assert.deepEqual(st.history, []);
});

test("findExerciseById: walks all days", () => {
  const program = {
    MON: { exercises:[{ id:"foo" }] },
    TUE: { exercises:[{ id:"bar" }] },
    WED: {},  // no exercises array
  };
  assert.equal(findExerciseById(program, "bar").id, "bar");
  assert.equal(findExerciseById(program, "missing"), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// scaleLoad
// ─────────────────────────────────────────────────────────────────────────────
test("scaleLoad: passthrough when mult is 1", () => {
  assert.equal(scaleLoad("100 lb DB", 1.0), "100 lb DB");
});

test("scaleLoad: rounds to nearest 5 lb at 80%", () => {
  assert.equal(scaleLoad("100 lb DB", 0.8), "80 lb DB");
  assert.equal(scaleLoad("110 lb",    0.8), "90 lb");  // 88 → 90
});

test("scaleLoad: scales lb-suffixed numbers, leaves rep / time numbers alone", () => {
  // "30 lb" scales (30→25 rounded to nearest 5), "10 reps" does not — neither
  // does the trailing 'reps' number.
  assert.equal(scaleLoad("30 lb / side × 10 reps", 0.8), "25 lb / side × 10 reps");
});

test("scaleLoad: leaves time strings (× 30s) untouched on MODERATE", () => {
  // Sat plate-pinch carry uses time in the load string; must not get scaled.
  assert.equal(scaleLoad("25 lb plates × 30s", 0.8), "20 lb plates × 30s");
  assert.equal(scaleLoad("45 lb plates × 45s", 0.8), "35 lb plates × 45s");
});

test("scaleLoad: leaves count strings (4 directions) untouched on MODERATE", () => {
  // Sat neck-iso load string has no weight at all — must pass through unchanged.
  assert.equal(scaleLoad("30s × 4 directions, hand resistance", 0.8), "30s × 4 directions, hand resistance");
});

test("scaleLoad: scales every lb-suffixed weight in mixed strings", () => {
  // Pre-existing "5 lb / cable 10 lb" type strings still scale all lb numbers.
  assert.equal(scaleLoad("5 lb plates / cable 10 lb", 0.8), "5 lb plates / cable 10 lb");
  // (5*0.8/5*5 = 5; 10*0.8/5*5 = 10 — small numbers round-trip due to /5 step)
});

// ─────────────────────────────────────────────────────────────────────────────
// seekStepByLoad
// ─────────────────────────────────────────────────────────────────────────────
const benchProg = [
  S(4,8,"90 lb",  90,  "7", G.rpe(7,2)),
  S(4,8,"100 lb", 100, "7", G.rpe(7,2)),
  S(4,8,"110 lb", 110, "7", G.rpe(7,2)),
  S(4,8,"120 lb", 120, "7", G.rpe(7,2)),
];

test("seekStepByLoad: exact match returns that index", () => {
  assert.equal(seekStepByLoad(benchProg, 100), 1);
  assert.equal(seekStepByLoad(benchProg, 120), 3);
});

test("seekStepByLoad: between steps picks the closer one", () => {
  assert.equal(seekStepByLoad(benchProg, 103), 1); // 100 closer than 110
  assert.equal(seekStepByLoad(benchProg, 107), 2); // 110 closer than 100
});

test("seekStepByLoad: load below first step clamps to 0", () => {
  assert.equal(seekStepByLoad(benchProg, 50), 0);
});

test("seekStepByLoad: load above last step clamps to last", () => {
  assert.equal(seekStepByLoad(benchProg, 200), 3);
});

test("seekStepByLoad: invalid input returns 0", () => {
  assert.equal(seekStepByLoad(benchProg, ""),       0);
  assert.equal(seekStepByLoad(benchProg, null),     0);
  assert.equal(seekStepByLoad(benchProg, NaN),      0);
  assert.equal(seekStepByLoad(benchProg, -50),      0);
  assert.equal(seekStepByLoad([],          100),    0);
  assert.equal(seekStepByLoad(undefined,   100),    0);
});

test("seekStepByLoad: tie picks the first (lower) step — conservative", () => {
  // Halfway between 100 and 110: should pick 100 (more conservative starting point)
  assert.equal(seekStepByLoad(benchProg, 105), 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// applyCalibration
// ─────────────────────────────────────────────────────────────────────────────
function makeCalProgram() {
  return {
    MON: { exercises: [
      { id:"bench", block:"A", progression: benchProg },
      { id:"curl",  block:"A", progression: [
        S(3,10,"45 lb",45,"7", G.rpe(7,2)),
        S(3,10,"55 lb",55,"7", G.rpe(7,2)),
        S(3,10,"65 lb",65,"7", G.rpe(7,2)),
      ]},
    ]},
  };
}

test("applyCalibration: sets stepIdx to closest step and clears that step's history", () => {
  const program = makeCalProgram();
  const before = {
    bench: { stepIdx:0, history:[
      { stepIdx:0, completed:true, topRPE:7 },
      { stepIdx:1, completed:true, topRPE:7 },
    ]},
  };
  const after = applyCalibration(before, program, { bench:110 });
  assert.equal(after.bench.stepIdx, 2);
  // Lower-step history preserved
  assert.deepEqual(after.bench.history.map(h=>h.stepIdx), [0, 1]);
});

test("applyCalibration: clears history at the newly-seeked step (clean gate slate)", () => {
  const program = makeCalProgram();
  const before = {
    bench: { stepIdx:1, history:[
      { stepIdx:1, completed:true, topRPE:9 },  // would be misleading at new step
      { stepIdx:1, completed:true, topRPE:9 },
    ]},
  };
  const after = applyCalibration(before, program, { bench:100 });
  assert.equal(after.bench.stepIdx, 1);
  assert.deepEqual(after.bench.history, []);
});

test("applyCalibration: skips empty / blank values", () => {
  const program = makeCalProgram();
  const before = { bench: { stepIdx:0, history:[] } };
  const after = applyCalibration(before, program, { bench:"", curl:null, missing:undefined });
  assert.deepEqual(after, before);
});

test("applyCalibration: leaves uncalibrated exercises untouched", () => {
  const program = makeCalProgram();
  const before = {
    bench: { stepIdx:0, history:[{ stepIdx:0, completed:true, topRPE:7 }] },
    curl:  { stepIdx:1, history:[{ stepIdx:1, completed:true, topRPE:7 }] },
  };
  const after = applyCalibration(before, program, { bench:110 });
  assert.equal(after.curl.stepIdx, 1);
  assert.deepEqual(after.curl.history, before.curl.history);
});

test("applyCalibration: unknown exercise id is skipped (no crash)", () => {
  const program = makeCalProgram();
  const after = applyCalibration({}, program, { not_real:100 });
  assert.deepEqual(after, {});
});

// ─────────────────────────────────────────────────────────────────────────────
// Date math — addDays / daysBetween
// ─────────────────────────────────────────────────────────────────────────────
test("addDays: forward, across month boundary", () => {
  assert.equal(addDays("2026-04-28", 7), "2026-05-05");
});
test("addDays: zero is identity, negative goes back", () => {
  assert.equal(addDays("2026-04-15", 0),  "2026-04-15");
  assert.equal(addDays("2026-04-15", -1), "2026-04-14");
});
test("daysBetween: same day is 0; forward is positive; backward is negative", () => {
  assert.equal(daysBetween("2026-04-15", "2026-04-15"), 0);
  assert.equal(daysBetween("2026-04-15", "2026-04-22"), 7);
  assert.equal(daysBetween("2026-04-22", "2026-04-15"), -7);
});

test("addDays: identity is exact for n=0 (regression: TZ-parsed dates used to shift to previous day in positive-offset TZs)", () => {
  // With local-TZ parsing + UTC setters, addDays("2026-05-08", 0) returned
  // "2026-05-07" in TZs like Asia/Tokyo. UTC parsing fixes it.
  assert.equal(addDays("2026-05-08",  0), "2026-05-08");
  assert.equal(addDays("2026-01-01",  0), "2026-01-01");
  assert.equal(addDays("2026-12-31",  0), "2026-12-31");
});

test("addDays + daysBetween roundtrip: addDays(d, n) is exactly n days later", () => {
  for (const n of [1, 7, 30, -1, -7]){
    const next = addDays("2026-05-08", n);
    assert.equal(daysBetween("2026-05-08", next), n);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// archiveExpiredDeload
// ─────────────────────────────────────────────────────────────────────────────
test("archiveExpiredDeload: moves expired current to history (endsOnActual = endsOn)", () => {
  const state = { current:{ startedOn:"2026-04-01", endsOn:"2026-04-07" }, history:[] };
  const after = archiveExpiredDeload(state, "2026-04-15");
  assert.equal(after.current, null);
  assert.equal(after.history.length, 1);
  assert.equal(after.history[0].endsOnActual, "2026-04-07");
});

test("archiveExpiredDeload: leaves active deload alone", () => {
  const state = { current:startDeload("2026-05-08"), history:[] };
  const after = archiveExpiredDeload(state, "2026-05-10");  // still active
  assert.deepEqual(after, state);
});

test("archiveExpiredDeload: null current is a no-op (returns valid empty state)", () => {
  assert.deepEqual(
    archiveExpiredDeload(undefined, "2026-05-08"),
    { current:null, history:[] }
  );
});

test("weeksSinceLastDeload: expired-but-not-archived current still counts", () => {
  // Regression: previously only history was scanned, so an unarchived expired
  // deload looked like "never deloaded" and reset the counter.
  const state = {
    current: { startedOn:"2026-04-01", endsOn:"2026-04-07" },
    history: [],
  };
  // 2026-04-07 → 2026-05-12 = 35 days = 5 weeks
  assert.equal(weeksSinceLastDeload(state, {}, "2026-05-12"), 5);
});

// ─────────────────────────────────────────────────────────────────────────────
// startDeload / getActiveDeload / endDeload
// ─────────────────────────────────────────────────────────────────────────────
test("startDeload: builds 7-day inclusive window by default", () => {
  const d = startDeload("2026-05-08");
  assert.equal(d.startedOn, "2026-05-08");
  assert.equal(d.endsOn,    "2026-05-14");  // 7 days inclusive
});

test("getActiveDeload: null when no current deload", () => {
  assert.equal(getActiveDeload({ current:null, history:[] }, "2026-05-08"), null);
  assert.equal(getActiveDeload(undefined, "2026-05-08"), null);
});

test("getActiveDeload: active on start day with full days remaining", () => {
  const state = { current: startDeload("2026-05-08"), history:[] };
  const a = getActiveDeload(state, "2026-05-08");
  assert.equal(a.daysRemaining, 7);
});

test("getActiveDeload: active on final day with 1 day remaining", () => {
  const state = { current: startDeload("2026-05-08"), history:[] };
  const a = getActiveDeload(state, "2026-05-14");
  assert.equal(a.daysRemaining, 1);
});

test("getActiveDeload: null the day after endsOn", () => {
  const state = { current: startDeload("2026-05-08"), history:[] };
  assert.equal(getActiveDeload(state, "2026-05-15"), null);
});

test("endDeload: moves current to history with actual end stamp", () => {
  const state = { current: startDeload("2026-05-08"), history:[] };
  const after = endDeload(state, "2026-05-10");  // end early on day 3
  assert.equal(after.current, null);
  assert.equal(after.history.length, 1);
  assert.equal(after.history[0].endsOnActual, "2026-05-10");
  assert.equal(after.history[0].startedOn,    "2026-05-08");
});

test("endDeload: no-op when nothing active", () => {
  const state = { current:null, history:[{ startedOn:"2026-04-01", endsOn:"2026-04-07" }] };
  assert.deepEqual(endDeload(state, "2026-05-10"), state);
});

// ─────────────────────────────────────────────────────────────────────────────
// weeksSinceLastDeload
// ─────────────────────────────────────────────────────────────────────────────
test("weeksSinceLastDeload: null when user has no sessions and never deloaded", () => {
  assert.equal(weeksSinceLastDeload({ current:null, history:[] }, {}, "2026-05-08"), null);
});

test("weeksSinceLastDeload: counts from earliest session when never deloaded", () => {
  const stepState = { bench: { stepIdx:0, history:[
    { date:"2026-04-01", completed:true, stepIdx:0 },
    { date:"2026-04-15", completed:true, stepIdx:0 },
  ]}};
  // 2026-04-01 → 2026-05-13 = 42 days = 6 weeks
  assert.equal(weeksSinceLastDeload({ current:null, history:[] }, stepState, "2026-05-13"), 6);
});

test("weeksSinceLastDeload: counts from end of most recent deload", () => {
  const deload = {
    current:null,
    history:[
      { startedOn:"2026-03-01", endsOn:"2026-03-07" },
      { startedOn:"2026-04-15", endsOn:"2026-04-21" },  // most recent
    ],
  };
  // 2026-04-21 → 2026-05-12 = 21 days = 3 weeks
  assert.equal(weeksSinceLastDeload(deload, {}, "2026-05-12"), 3);
});

test("weeksSinceLastDeload: prefers endsOnActual when set (early end)", () => {
  const deload = {
    current:null,
    history:[{ startedOn:"2026-04-15", endsOn:"2026-04-21", endsOnActual:"2026-04-18" }],
  };
  // 2026-04-18 → 2026-05-09 = 21 days = 3 weeks
  assert.equal(weeksSinceLastDeload(deload, {}, "2026-05-09"), 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateGate — DELOAD/RECOVERY entries are excluded from counts
// ─────────────────────────────────────────────────────────────────────────────
test("evaluateGate (RPE_BELOW): DELOAD sessions don't count toward the streak", () => {
  // 2 HARD sessions at RPE 7 would clear the gate, but a DELOAD entry between
  // them must NOT contaminate the lastN window — it should be skipped entirely.
  const r = evaluateGate(G.rpe(7, 2), [
    { completed:true, topRPE:7, tier:"HARD" },
    { completed:true, topRPE:5, tier:"DELOAD" },   // ignored
    { completed:true, topRPE:7, tier:"HARD" },
  ]);
  assert.equal(r.cleared, true);
});

test("evaluateGate (RPE_PAIN): DELOAD sessions don't satisfy HARD-confirmation", () => {
  // The only "HARD" entry is actually a DELOAD — filtered out — so no HARD
  // remains in the qualifying window. Gate must NOT clear.
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:6, painBack:1, painShoulder:0, tier:"MODERATE" },
    { completed:true, topRPE:5, painBack:0, painShoulder:0, tier:"DELOAD"   },
    { completed:true, topRPE:6, painBack:1, painShoulder:0, tier:"MODERATE" },
  ]);
  assert.equal(r.cleared, false);
});

test("evaluateGate (PAIN_FREE_WEEKS): DELOAD weeks don't count toward the window", () => {
  // 3 pain-free weeks but the middle one is DELOAD — should count as 2.
  const r = evaluateGate(G.weeks(3, 2), [
    { completed:true, date:"2026-04-06", painBack:0, painShoulder:0, tier:"HARD"   },
    { completed:true, date:"2026-04-13", painBack:0, painShoulder:0, tier:"DELOAD" },
    { completed:true, date:"2026-04-20", painBack:0, painShoulder:0, tier:"HARD"   },
  ]);
  assert.equal(r.cleared, false);
  assert.match(r.progress, /^2\/3/);
});

// Sanity check: DELOAD_DURATION_DAYS is a sensible default
test("DELOAD_DURATION_DAYS is 7", () => {
  assert.equal(DELOAD_DURATION_DAYS, 7);
});
