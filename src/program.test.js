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
    { completed:true, topRPE:7, painBack:3, painShoulder:0 },
    { completed:true, topRPE:7, painBack:1, painShoulder:0 },
  ]);
  assert.equal(r.cleared, false);
});

test("RPE_PAIN: clears when both RPE and pain stay under thresholds", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:7, painBack:1, painShoulder:0 },
    { completed:true, topRPE:7, painBack:2, painShoulder:1 },
  ]);
  assert.equal(r.cleared, true);
});

test("RPE_PAIN: shoulder pain alone breaks the gate", () => {
  const r = evaluateGate(G.rpePain(7.5, 2, 2), [
    { completed:true, topRPE:7, painBack:0, painShoulder:5 },
    { completed:true, topRPE:7, painBack:0, painShoulder:0 },
  ]);
  assert.equal(r.cleared, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateGate — PAIN_FREE_WEEKS
// ─────────────────────────────────────────────────────────────────────────────
test("PAIN_FREE_WEEKS: clears when distinct pain-free ISO weeks ≥ target", () => {
  const r = evaluateGate(G.weeks(3, 2), [
    { completed:true, date:"2026-04-06", painBack:1, painShoulder:0 },
    { completed:true, date:"2026-04-13", painBack:0, painShoulder:1 },
    { completed:true, date:"2026-04-20", painBack:2, painShoulder:0 },
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
