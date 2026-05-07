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

test("scaleLoad: scales every numeric token in the string", () => {
  // Documents current behavior: /g flag scales all numbers, not just first.
  assert.equal(scaleLoad("30 lb / side × 10 reps", 0.8), "25 lb / side × 10 reps");
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
