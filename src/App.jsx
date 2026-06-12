import { useState, useRef, useEffect } from "react";
import { useOuraSync } from "./hooks/useOuraSync";
import {
  BLOCK_RANK, BLOCK_CONFIG, BLOCK_TRANSITION_ANCHORS, blockLabel,
  G, S,
  evaluateGate, getStepState, findExerciseById, isBlockTransitionReady,
  getVisibleExercises, getLockedPreview, evaluateDeloadTriggers,
  scaleLoad,
  applyCalibration,
  getActiveDeload, startDeload, endDeload, archiveExpiredDeload, weeksSinceLastDeload,
  DELOAD_DURATION_DAYS, DELOAD_LOAD_MULT, DELOAD_SUGGEST_AFTER_WEEKS,
} from "./program";
// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a strength and longevity coach for a 47-year-old male (back injury recovery, shoulder issues, Oura Ring user). Draw from Dr. Vonda Wright, Peter Attia, Stuart McGill, Andy Galpin, Pavel Tsatsouline, Matthew Walker, and Gabrielle Lyon.
Targets (long-horizon, gate-based — not deadlines): DL 550, SQ 450, DB bench 150, OHP 150, BB curl 80+.
Program model: open-ended macro cycle Block A → B → C → D. Each exercise advances by criteria gate (RPE_BELOW, RPE_PAIN, PAIN_FREE_WEEKS), not calendar weeks. Block transition only when anchor exercises clear final-step gate.
Core rules:
- Protein: 1g/lb bodyweight minimum, 40-50g at first meal, creatine 3-5g daily always
- Training: protect the spine, Zone 2 at ~133 bpm, progressive overload without ego
- Sleep: Oura readiness 80+ = train hard, 70-79 = moderate (80% loads), below 70 = recovery only
- HRV dropping 3+ days = cut volume. Elevated resting HR 5+ bpm = Zone 2 or rest
- Deload weeks: manual 7-day back-off (60% loads, RPE cap 6). System suggests one every 6+ weeks. Sessions logged during a deload do NOT count toward gate progression — by design.
- Block A: trap-bar high handle DL, goblet box squat, DB bench/OHP, accessory curls
- Block B unlocks SSB squat + seated BB OHP + shoulder prehab — gated on pain-free weeks
- No prolonged fasting on training days
- Sarcopenia is the enemy — muscle mass is non-negotiable after 45
Always give specific numbers. Reference current block, current exercise step, and gate progress when relevant. No vague advice. No fluff.`;

// ─────────────────────────────────────────────────────────────────────────────
// TIER CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const TIER_CONFIG = {
  HARD:     { label:"TRAIN HARD",    range:"READINESS ≥ 80", color:"#4ade80", bg:"rgba(74,222,128,0.08)",  border:"#4ade80",  desc:"Full intensity. Progressive overload. Heavy compounds confirm gate progress." },
  MODERATE: { label:"MODERATE",      range:"READINESS 70–79", color:"#facc15", bg:"rgba(250,204,21,0.08)",  border:"#facc15",  desc:"Sub-maximal effort (80% loads). Builds work capacity but heavy compounds need a HARD day to advance." },
  DELOAD:   { label:"DELOAD WEEK",   range:"manual / suggested", color:"#fb923c", bg:"rgba(251,146,60,0.08)", border:"#fb923c",  desc:"Deliberate back-off. Loads scaled to 60%. RPE cap 6. Sessions do NOT count toward gate progress." },
  RECOVERY: { label:"RECOVERY ONLY", range:"READINESS < 70",  color:"#f87171", bg:"rgba(248,113,113,0.08)", border:"#f87171",  desc:"Zone 2 walk, mobility, McGill Big 3. No loading." },
};

const OURA_SOURCE_LABEL = {
  oura:             "LIVE",
  cache:            "CACHE",
  manual_override:  "MANUAL",
  manual:           "FALLBACK",
};
const OURA_SOURCE_COLOR = {
  oura:             "#4ade80",
  cache:            "#facc15",
  manual_override:  "#6aaa6a",
  manual:           "#f87171",
};

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM — criteria-gated progression, open-ended macro cycle
//
// Per exercise: { id, block:"A"|"B"|..., name, cue, replaces?:exId, progression:[step,...] }
// Per step:     { sets, reps, load, loadNum, rpe, gate }
// Gate types:
//   RPE_BELOW       — top-set RPE ≤ N for K sessions  (accessories)
//   RPE_PAIN        — + back/shoulder pain ≤ N        (heavy compounds)
//   PAIN_FREE_WEEKS — N pain-free weeks at top load   (phase transitions)
//   null            — maintenance, no progression
//
// Targets: DL 550 / SQ 450 / DB bench 150 / OHP 150 / curl 80+
// Constraints: back injury recovery, shoulder issues. Longevity > speed.
// Pure helpers (BLOCK_*, G, S, evaluateGate, etc.) live in ./program.js
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM = {
  SUN: {
    label: "SUNDAY", focus: "ZONE 2 CARDIO", type: "cardio",
    cardio: [{ name: "ZONE 2 STEADY STATE", duration: "60 min", target: "~133 bpm", note: "Conversational pace. Nasal breathing preferred." }],
  },
  MON: {
    label: "MONDAY", focus: "LIFT + ZONE 2", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 POST-LIFT", duration: "60 min", target: "~133 bpm", note: "After lifting. Keep HR ≤133." }],
    warmup: ["McGill Big 3 — 3×10 each", "Goblet squat (light) — 2×8", "Band pull-apart — 2×15"],
    exercises: [
      {
        id:"goblet_sq", block:"A", name:"GOBLET BOX SQUAT",
        cue:"Sit to box, hip crease at or below knee, brace before descending",
        progression: [
          S(3,8,"70 lb DB", 70, "RPE 6–7", G.rpe(7, 2)),
          S(3,8,"75 lb DB", 75, "RPE 6–7", G.rpe(7, 2)),
          S(3,8,"80 lb DB", 80, "RPE 7",   G.rpe(7, 2)),
          S(3,8,"85 lb DB", 85, "RPE 7",   G.rpe(7.5, 2)),
          S(3,8,"90 lb DB", 90, "RPE 7",   G.rpe(7.5, 2)),
          S(4,8,"95 lb DB", 95, "RPE 7–8", G.rpe(8, 2)),
          S(4,8,"100 lb DB",100,"RPE 8",   G.weeks(3, 2)),  // → unlock SSB squat
        ],
      },
      {
        id:"ssb_squat", block:"B", replaces:"goblet_sq", name:"SSB BOX SQUAT",
        cue:"Safety squat bar — back-friendly. Sit to box, brace hard, drive up. Start light, RPE 6.",
        progression: [
          S(3,5,"135 lb",135,"RPE 6 — pattern",      G.rpePain(6, 2, 3)),
          S(3,5,"155 lb",155,"RPE 6",                 G.rpePain(6.5, 2, 3)),
          S(4,5,"175 lb",175,"RPE 7",                 G.rpePain(7, 2, 3)),
          S(4,5,"195 lb",195,"RPE 7",                 G.rpePain(7, 2, 3)),
          S(4,5,"215 lb",215,"RPE 7–8",               G.rpePain(7.5, 2, 3)),
          S(5,3,"235 lb",235,"RPE 8",                 G.rpePain(8, 2, 3)),
          S(5,3,"255 lb",255,"RPE 8",                 G.rpePain(8, 2, 3)),
          S(5,3,"275 lb",275,"RPE 8 — HARD only",     G.weeks(4, 2)),  // → Block C transition
        ],
      },
      {
        id:"ssb_free_sq", block:"C", replaces:"ssb_squat", name:"SSB FREE SQUAT",
        cue:"No box — control descent, hip crease at or below knee, brace before each rep. Rebuild from a lighter load — free squat is harder than box at the same weight.",
        progression: [
          S(3,5,"235 lb",235,"RPE 6 — pattern",       G.rpePain(6, 2, 3)),
          S(3,5,"255 lb",255,"RPE 6–7",               G.rpePain(6.5, 2, 3)),
          S(4,5,"275 lb",275,"RPE 7",                 G.rpePain(7, 2, 3)),
          S(4,5,"295 lb",295,"RPE 7",                 G.rpePain(7, 2, 3)),
          S(4,5,"315 lb",315,"RPE 7–8",               G.rpePain(7.5, 2, 3)),
          S(5,3,"335 lb",335,"RPE 8 — HARD only",     G.rpePain(8, 2, 3)),
          S(5,3,"355 lb",355,"RPE 8 — HARD only",     G.weeks(4, 2)),  // → Block D transition contributor
        ],
      },
      {
        id:"db_bench_mon", block:"A", name:"DB BENCH PRESS",
        cue:"Retract scapula, controlled descent, 90s rest between sets",
        progression: [
          S(4,8,"90 lb DB",  90, "RPE 7",    G.rpe(7, 2)),
          S(4,8,"95 lb DB",  95, "RPE 7",    G.rpe(7, 2)),
          S(4,8,"100 lb DB",100, "RPE 7",    G.rpe(7, 2)),
          S(4,8,"105 lb DB",105, "RPE 7–8",  G.rpe(7.5, 2)),
          S(5,6,"110 lb DB",110, "RPE 7–8",  G.rpe(8, 2)),
          S(5,6,"115 lb DB",115, "RPE 8 — HARD only", G.rpe(8, 2)),
          S(5,5,"120 lb DB",120, "RPE 8 — HARD only", G.rpe(8, 2)),
          S(5,5,"125 lb DB",125, "RPE 8 — HARD only", G.weeks(3, 2)),  // → Block B unlock contributor
        ],
      },
      {
        id:"cable_row_mon", block:"A", name:"CABLE SEATED ROW",
        cue:"Drive elbows back, full contraction, no momentum",
        progression: [
          S(3,10,"160 lb",160,"controlled", G.rpe(7, 2)),
          S(3,10,"170 lb",170,"controlled", G.rpe(7, 2)),
          S(4,10,"180 lb",180,"controlled", G.rpe(7, 2)),
          S(4,10,"190 lb",190,"controlled", G.rpe(7.5, 2)),
          S(4,10,"200 lb",200,"controlled", G.rpe(8, 2)),
          S(4,8, "210 lb",210,"controlled", G.rpe(8, 2)),
        ],
      },
      {
        id:"bb_curl_mon", block:"A", name:"BARBELL CURL",
        cue:"Strict — no body swing. Elbows pinned. Full ROM. Toward 80+ lb goal.",
        progression: [
          S(3,10,"45 lb",45,"RPE 7",  G.rpe(7, 2)),
          S(3,10,"55 lb",55,"RPE 7",  G.rpe(7, 2)),
          S(3,10,"65 lb",65,"RPE 7–8",G.rpe(7.5, 2)),
          S(4,8, "75 lb",75,"RPE 8",  G.rpe(8, 2)),
          S(4,8, "85 lb",85,"RPE 8",  G.rpe(8, 2)),
          S(4,6, "95 lb",95,"RPE 8 — HARD only", G.rpe(8, 2)),
        ],
      },
      {
        id:"pallof_mon", block:"A", name:"PALLOF PRESS",
        cue:"No rotation — this is anti-rotation. Brace hard, press to full extension, hold 2s",
        progression: [
          S(3,10,"25 lb / side",25,"strict", G.rpe(7, 2)),
          S(3,10,"30 lb / side",30,"strict", G.rpe(7, 2)),
          S(3,12,"35 lb / side",35,"strict", G.rpe(7, 2)),
          S(3,12,"40 lb / side",40,"strict", G.rpe(7.5, 2)),
        ],
      },
    ],
  },
  TUE: {
    label: "TUESDAY", focus: "LIFT + ZONE 2", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 POST-LIFT", duration: "60 min", target: "~133 bpm", note: "After lifting." }],
    warmup: ["Hip hinge drill — 2×10", "Glute bridge — 2×15", "Dead bug — 2×10/side"],
    exercises: [
      {
        id:"trap_bar", block:"A", name:"TRAP BAR DEADLIFT (HIGH HANDLES)",
        cue:"Hinge — not squat. Brace before pull. No lumbar rounding. High handles protect spine.",
        progression: [
          S(4,5,"305 lb",305,"RPE 7",            G.rpePain(7, 2, 3)),
          S(4,5,"320 lb",320,"RPE 7",            G.rpePain(7, 2, 3)),
          S(5,4,"335 lb",335,"RPE 7–8",          G.rpePain(7.5, 2, 3)),
          S(5,4,"350 lb",350,"RPE 8 — HARD only",G.rpePain(8, 2, 3)),
          S(5,3,"365 lb",365,"RPE 8 — HARD only",G.rpePain(8, 2, 3)),
          S(5,3,"380 lb",380,"RPE 8 — HARD only",G.rpePain(8, 2, 3)),
          S(5,2,"395 lb",395,"RPE 8–9 — HARD only", G.rpePain(8.5, 2, 3)),
          S(5,2,"410 lb",410,"RPE 8–9 — HARD only + back ≤2/10", G.rpePain(8.5, 2, 3)),
          S(5,2,"425 lb",425,"RPE 9 — HARD only + back ≤2/10",   G.weeks(4, 2)),  // → Block B unlock contributor
        ],
      },
      {
        id:"lat_pull", block:"A", name:"LAT PULLDOWN",
        cue:"Lean back slightly, pull to upper chest, full stretch overhead, controlled",
        progression: [
          S(4,10,"180 lb",180,"controlled", G.rpe(7, 2)),
          S(4,10,"190 lb",190,"controlled", G.rpe(7, 2)),
          S(4,10,"200 lb",200,"controlled", G.rpe(7.5, 2)),
          S(4,8, "210 lb",210,"controlled", G.rpe(8, 2)),
          S(5,8, "220 lb",220,"controlled", G.rpe(8, 2)),
        ],
      },
      {
        id:"hip_thrust", block:"A", name:"BARBELL HIP THRUST",
        cue:"Chin tucked, glute squeeze at top, no lumbar overextension",
        progression: [
          S(3,10,"180 lb",180,"RPE 6–7",  G.rpe(7, 2)),
          S(3,10,"200 lb",200,"RPE 7",    G.rpe(7, 2)),
          S(3,10,"220 lb",220,"RPE 7",    G.rpe(7, 2)),
          S(3,10,"240 lb",240,"RPE 7–8",  G.rpe(7.5, 2)),
          S(4,10,"260 lb",260,"RPE 8",    G.rpe(8, 2)),
          S(4,10,"280 lb",280,"RPE 8",    G.rpe(8, 2)),
          S(4,8, "300 lb",300,"RPE 8",    G.rpe(8, 2)),
          S(4,6, "320 lb",320,"RPE 8 — HARD only", G.rpe(8, 2)),
        ],
      },
      {
        id:"face_pull", block:"A", name:"CABLE FACE PULL",
        cue:"Pull to forehead, external rotate at end. Rear delt + rotator cuff health.",
        progression: [
          S(2,15,"50 lb",50,"controlled", G.rpe(7, 2)),
          S(3,15,"55 lb",55,"controlled", G.rpe(7, 2)),
          S(3,15,"60 lb",60,"controlled", G.rpe(7, 2)),
          S(3,15,"65 lb",65,"controlled", G.rpe(7, 2)),
          S(3,15,"70 lb",70,"controlled", G.rpe(7, 2)),
        ],
      },
    ],
  },
  WED: {
    label: "WEDNESDAY", focus: "LIGHT CARDIO + McGILL", type: "cardio",
    cardio: [
      { name: "ZONE 2 EASY WALK / BIKE", duration: "30 min", target: "120–128 bpm", note: "Light effort — this is active recovery, not training." },
      { name: "McGILL BIG 3", duration: "1 round", target: "3×10 each side", note: "Curl-up, side plank, bird-dog. Non-negotiable." },
    ],
  },
  THU: {
    label: "THURSDAY", focus: "LIFT (AM) + ZONE 2 (PM)", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 PM SESSION", duration: "60 min", target: "~133 bpm", note: "Separate from lifting by 4+ hours if possible." }],
    warmup: ["Band pull-apart — 3×15", "Wall slides — 2×12", "Y-T-W on bench — 2×8 each", "Cable external rotation — 2×12/side"],
    exercises: [
      {
        id:"incline_db", block:"A", name:"INCLINE DB BENCH PRESS",
        cue:"30–45° incline. Retract scapula. Controlled descent. No bounce.",
        progression: [
          S(4,6,"80 lb DB",  80, "RPE 7",   G.rpe(7, 2)),
          S(4,6,"85 lb DB",  85, "RPE 7",   G.rpe(7, 2)),
          S(4,6,"90 lb DB",  90, "RPE 7–8", G.rpe(7.5, 2)),
          S(4,6,"95 lb DB",  95, "RPE 7–8", G.rpe(8, 2)),
          S(4,5,"100 lb DB",100, "RPE 8",   G.rpe(8, 2)),
          S(4,5,"105 lb DB",105, "RPE 8 — HARD only", G.rpe(8, 2)),
          S(4,5,"110 lb DB",110, "RPE 8 — HARD only", G.rpe(8, 2)),
        ],
      },
      {
        id:"cable_row_thu", block:"A", name:"CABLE ROW (CHEST-SUPPORTED)",
        cue:"No momentum. Row to lower chest. Full stretch at extension.",
        progression: [
          S(4,8,"160 lb",160,"controlled", G.rpe(7, 2)),
          S(4,8,"170 lb",170,"controlled", G.rpe(7, 2)),
          S(4,8,"180 lb",180,"controlled", G.rpe(7.5, 2)),
          S(4,8,"190 lb",190,"controlled", G.rpe(8, 2)),
          S(5,8,"200 lb",200,"controlled", G.rpe(8, 2)),
        ],
      },
      {
        id:"shoulder_prehab", block:"A", name:"SHOULDER PREHAB BLOCK",
        cue:"Y-T-W on bench + cable external rotation + Cuban press. Non-negotiable before pressing.",
        progression: [
          S(3,12,"5 lb plates / cable 10 lb", 10, "strict — no momentum", G.none()),
          S(3,12,"7.5 lb / cable 12 lb",     12, "strict",                G.none()),
          S(3,12,"10 lb / cable 15 lb",      15, "strict",                G.none()),
        ],
      },
      {
        id:"seated_db_press", block:"A", name:"SEATED DB SHOULDER PRESS",
        cue:"Neutral spine, no lumbar arch — brace before every rep. Press straight overhead.",
        progression: [
          S(3,8,"45 lb DB",45,"RPE 6–7", G.rpePain(7, 2, 2)),
          S(3,8,"50 lb DB",50,"RPE 7",   G.rpePain(7, 2, 2)),
          S(3,8,"55 lb DB",55,"RPE 7",   G.rpePain(7, 2, 2)),
          S(4,8,"60 lb DB",60,"RPE 7–8", G.rpePain(7.5, 2, 2)),
          S(4,6,"65 lb DB",65,"RPE 8",   G.rpePain(8, 2, 2)),
          S(4,6,"70 lb DB",70,"RPE 8 — HARD only", G.rpePain(8, 2, 2)),
          S(4,5,"75 lb DB",75,"RPE 8 — HARD only", G.weeks(3, 2)),  // → unlock seated BB OHP
        ],
      },
      {
        id:"seated_bb_ohp", block:"B", replaces:"seated_db_press", name:"SEATED BARBELL OHP",
        cue:"Back-supported. Brace before every rep. Press to lockout, controlled descent. Shoulder prehab MUST be done first.",
        progression: [
          S(4,5,"95 lb",  95, "RPE 6 — pattern",        G.rpePain(6.5, 2, 3)),
          S(4,5,"105 lb",105, "RPE 7",                   G.rpePain(7, 2, 3)),
          S(4,5,"115 lb",115, "RPE 7",                   G.rpePain(7, 2, 3)),
          S(5,4,"125 lb",125, "RPE 7–8",                 G.rpePain(7.5, 2, 3)),
          S(5,4,"135 lb",135, "RPE 8 — HARD only",       G.rpePain(8, 2, 3)),
          S(5,3,"145 lb",145, "RPE 8 — HARD only",       G.rpePain(8, 2, 3)),
          S(5,3,"155 lb",155, "RPE 8 — HARD only",       G.weeks(4, 2)),  // → Block C standing BB OHP
        ],
      },
      {
        id:"hammer_curl_thu", block:"A", name:"HAMMER CURL",
        cue:"Neutral grip — protects elbow. Strict, no swing. Toward 50 lb DB / hand.",
        progression: [
          S(3,10,"25 lb DB",25,"RPE 7",  G.rpe(7, 2)),
          S(3,10,"30 lb DB",30,"RPE 7",  G.rpe(7, 2)),
          S(3,10,"35 lb DB",35,"RPE 7–8",G.rpe(7.5, 2)),
          S(4,8, "40 lb DB",40,"RPE 8",  G.rpe(8, 2)),
          S(4,8, "45 lb DB",45,"RPE 8",  G.rpe(8, 2)),
          S(4,6, "50 lb DB",50,"RPE 8",  G.rpe(8, 2)),
        ],
      },
      {
        id:"tri_pressdown", block:"A", name:"TRICEPS CABLE PRESSDOWN",
        cue:"Lock elbows at sides, full extension, controlled return",
        progression: [
          S(3,12,"60 lb",60,"controlled", G.rpe(7, 2)),
          S(3,12,"70 lb",70,"controlled", G.rpe(7, 2)),
          S(3,12,"80 lb",80,"controlled", G.rpe(7.5, 2)),
          S(3,10,"90 lb",90,"controlled", G.rpe(8, 2)),
        ],
      },
    ],
  },
  FRI: {
    label: "FRIDAY", focus: "LIFT (AM) + ZONE 2 (PM)", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 PM SESSION", duration: "45–60 min", target: "~133 bpm", note: "Separate from lifting. Easy pace." }],
    warmup: ["Lateral band walk — 2×15", "Goblet squat hold 30s", "Hip flexor stretch 60s/side"],
    exercises: [
      {
        id:"split_sq", block:"A", name:"BULGARIAN SPLIT SQUAT (DB)",
        cue:"Front foot far enough — torso upright, knee tracks toe. NO spinal loading.",
        progression: [
          S(3,8,"20 lb DB / side",20,"RPE 6–7", G.rpe(7, 2)),
          S(3,8,"25 lb DB / side",25,"RPE 7",   G.rpe(7, 2)),
          S(3,8,"30 lb DB / side",30,"RPE 7",   G.rpe(7, 2)),
          S(4,8,"35 lb DB / side",35,"RPE 7–8", G.rpe(7.5, 2)),
          S(4,8,"40 lb DB / side",40,"RPE 8",   G.rpe(8, 2)),
          S(4,6,"45 lb DB / side",45,"RPE 8",   G.rpe(8, 2)),
          S(4,6,"50 lb DB / side",50,"RPE 8 — HARD only", G.rpe(8, 2)),
        ],
      },
      {
        id:"cable_ham", block:"A", name:"CABLE HAMSTRING CURL (SINGLE LEG)",
        cue:"Full ROM, slow eccentric (3s), don't let hip flexors dominate",
        progression: [
          S(3,12,"30 lb / side",30,"controlled", G.rpe(7, 2)),
          S(3,12,"35 lb / side",35,"controlled", G.rpe(7, 2)),
          S(3,12,"40 lb / side",40,"controlled", G.rpe(7.5, 2)),
          S(4,12,"45 lb / side",45,"controlled", G.rpe(8, 2)),
          S(4,12,"50 lb / side",50,"controlled", G.rpe(8, 2)),
        ],
      },
      {
        id:"single_leg_rdl", block:"A", name:"SINGLE-LEG RDL (DB)",
        cue:"Hinge at the hip, flat back, slight knee bend. Reach the DBs down the working leg, square hips — don't open up. Balance + posterior chain, no spinal loading.",
        progression: [
          S(3,10,"25 lb DB / side",25,"RPE 6–7 — own the balance", G.rpe(7, 2)),
          S(3,10,"30 lb DB / side",30,"RPE 7",                     G.rpe(7, 2)),
          S(3,10,"35 lb DB / side",35,"RPE 7",                     G.rpe(7.5, 2)),
          S(3,8, "40 lb DB / side",40,"RPE 8",                     G.rpe(8, 2)),
          S(4,8, "45 lb DB / side",45,"RPE 8",                     G.rpe(8, 2)),
          S(4,8, "50 lb DB / side",50,"RPE 8",                     G.rpe(8, 2)),
          S(4,8, "55 lb DB / side",55,"RPE 8 — HARD only",         G.rpe(8, 2)),
        ],
      },
      {
        id:"farmer", block:"A", name:"FARMER CARRY",
        cue:"Tall posture, packed shoulders, crisp steps — core endurance under load",
        progression: [
          S(5,1,"80 lb / hand × 30m", 80, "RPE 6",        G.rpe(7, 2)),
          S(5,1,"90 lb / hand × 35m", 90, "controlled",   G.rpe(7, 2)),
          S(5,1,"100 lb / hand × 40m",100,"controlled",   G.rpe(7, 2)),
          S(5,1,"110 lb / hand × 40m",110,"controlled",   G.rpe(7.5, 2)),
          S(6,1,"120 lb / hand × 40m",120,"controlled",   G.rpe(8, 2)),
        ],
      },
    ],
  },
  SAT: {
    label: "SATURDAY", focus: "FUNCTIONAL / COMBAT MOBILITY", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 WALK", duration: "20 min", target: "120–128 bpm", note: "Easy walk. Cooldown after the mobility work." }],
    warmup: ["World's Greatest Stretch — 5/side", "90/90 Hip Transitions — 8/side", "Scapular CARs — 8/direction"],
    note: "FUNCTIONAL DAY — practical strength + mobility for fighting / martial arts. Light-to-mid loads, higher reps. RPE 5–7 cap. Movement quality > load. KB preferred where listed; DB works fine as substitute.",
    exercises: [
      {
        id:"tgu_sat", block:"A", name:"TURKISH GET-UP",
        cue:"KB or DB. One slow rep = full ground-to-stand-to-ground. Lock the bell overhead, eyes on it the whole time. Crown jewel for shoulder mobility under load + hip integration.",
        progression: [
          S(3,1,"25 lb KB / side",25,"RPE 5 — pattern", G.rpe(5, 2)),
          S(3,1,"35 lb KB / side",35,"RPE 5",          G.rpe(5, 2)),
          S(4,1,"45 lb KB / side",45,"RPE 6",          G.rpe(6, 2)),
          S(5,1,"53 lb KB / side",53,"RPE 6",          G.rpe(6, 2)),
          S(5,1,"62 lb KB / side",62,"RPE 6–7",        G.rpe(7, 2)),
          S(5,1,"70 lb KB / side",70,"RPE 7",          G.rpe(7, 2)),
        ],
      },
      {
        id:"cossack_sat", block:"A", name:"COSSACK SQUAT",
        cue:"Heel down, opposite leg straight. Sit deep, push knee out, drive up through working heel. Hip mobility + lateral leg strength for sprawls and kicking range.",
        progression: [
          S(3,10,"bodyweight",       0, "RPE 5", G.rpe(5, 2)),
          S(3,12,"bodyweight",       0, "RPE 5", G.rpe(5, 2)),
          S(3,10,"25 lb DB goblet", 25, "RPE 6", G.rpe(6, 2)),
          S(3,12,"35 lb DB goblet", 35, "RPE 6", G.rpe(6, 2)),
          S(3,12,"45 lb DB goblet", 45, "RPE 6", G.rpe(6, 2)),
          S(3,12,"55 lb DB goblet", 55, "RPE 7", G.rpe(7, 2)),
        ],
      },
      {
        id:"windmill_sat", block:"A", name:"KETTLEBELL WINDMILL",
        cue:"KB locked overhead, eyes on it. Hinge to opposite foot, keep front leg straight. Light. Builds shoulder mobility under load + oblique/hamstring length — defends arm bars and kimuras.",
        progression: [
          S(2,8,"15 lb KB / side", 15, "RPE 5", G.rpe(5, 2)),
          S(2,8,"20 lb KB / side", 20, "RPE 5", G.rpe(5, 2)),
          S(3,8,"25 lb KB / side", 25, "RPE 6", G.rpe(6, 2)),
          S(3,8,"30 lb KB / side", 30, "RPE 6", G.rpe(6, 2)),
          S(3,8,"35 lb KB / side", 35, "RPE 6–7", G.rpe(7, 2)),
        ],
      },
      {
        id:"woodchop_sat", block:"A", name:"CABLE WOOD CHOP (HIGH-TO-LOW + LOW-TO-HIGH)",
        cue:"Controlled tempo — NOT explosive (back history). Pivot through hips, arms straight. Alternate high-to-low and low-to-high each set. Rotational power for strikes, takedowns, throws.",
        progression: [
          S(3,12,"30 lb / side", 30, "RPE 5 — controlled", G.rpe(5, 2)),
          S(3,12,"40 lb / side", 40, "RPE 6 — controlled", G.rpe(6, 2)),
          S(3,15,"50 lb / side", 50, "RPE 6", G.rpe(6, 2)),
          S(3,15,"60 lb / side", 60, "RPE 6", G.rpe(6, 2)),
          S(4,15,"70 lb / side", 70, "RPE 7", G.rpe(7, 2)),
        ],
      },
      {
        id:"pinch_carry_sat", block:"A", name:"PLATE PINCH CARRY",
        cue:"Pinch two plates together by the smooth side, walk tall. Grip endurance for clinch, gi grip, wrist control. Replaces farmer carry on Sat — more grip-specific.",
        progression: [
          S(3,1,"25 lb plates × 30s", 25, "RPE 5", G.rpe(5, 2)),
          S(3,1,"25 lb plates × 40s", 25, "RPE 6", G.rpe(6, 2)),
          S(3,1,"35 lb plates × 40s", 35, "RPE 6", G.rpe(6, 2)),
          S(3,1,"45 lb plates × 45s", 45, "RPE 7", G.rpe(7, 2)),
        ],
      },
      {
        id:"neck_iso_sat", block:"A", name:"NECK ISOMETRICS (3-WAY)",
        cue:"Front, back, both sides — 30s each direction. Hand resistance only. NO neck bridges (back history). Builds tolerance for punches and takedown impact.",
        progression: [
          S(3,1,"30s × 4 directions, hand resistance", 0, "strict", G.none()),
        ],
      },
      {
        id:"big3_sat", block:"A", name:"McGILL BIG 3",
        cue:"Curl-up, side plank, bird-dog. 3×10 each. Spine endurance is the foundation for everything else on this list.",
        progression: [
          S(3,10,"bodyweight", 0,"strict", G.none()),
        ],
      },
    ],
  },
};

const DAY_ORDER = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

// ─────────────────────────────────────────────────────────────────────────────
// REACT-LAYER HELPERS (impure / DOM-aware)
// Pure helpers (evaluateGate, getVisibleExercises, etc.) live in ./program.js
// ─────────────────────────────────────────────────────────────────────────────
function getTier(r){ return r>=80?"HARD":r>=70?"MODERATE":"RECOVERY"; }
function getHRVAlert(avg,today){ if(!avg||!today)return null; const d=avg-today; return d>=3?`HRV DOWN ${d}MS VS 7-DAY — CUT VOLUME`:null; }
function getRHRAlert(base,today){ if(!base||!today)return null; const r=today-base; return r>=5?`RHR +${r} BPM ABOVE BASELINE — ZONE 2 OR REST`:null; }
function todayKey(){ return DAY_ORDER[new Date().getDay()]; }

const LS_STEP_STATE         = "sqb_step_state";
const LS_CURRENT_BLOCK      = "sqb_current_block";
const LS_READINESS_HISTORY  = "sqb_readiness_history";
const LS_DELOAD_STATE       = "sqb_deload_state";
function lsLoad(k, fallback){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }catch{ return fallback; } }
function lsSave(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{ /* storage full or disabled — non-fatal */ } }
function todayISO(){ return new Date().toISOString().slice(0,10); }

const MONO = { fontFamily:"'Courier New',monospace" };
const BASE_INPUT = { background:"#0a0f0a", border:"1px solid #2d4a2d", color:"#c8d4c8", padding:"5px 7px", ...MONO, fontSize:11, outline:"none", width:"100%", boxSizing:"border-box" };

// ─────────────────────────────────────────────────────────────────────────────
// SET ROW COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function SetRow({ setNum, reps, load, rpe, mult, actual, onChange }) {
  const displayLoad = mult < 1.0 ? scaleLoad(load, mult) : load;
  const done = actual?.done;
  return (
    <div style={{
      display:"grid", gridTemplateColumns:"26px 50px 1fr 85px 1fr 90px",
      gap:5, alignItems:"center", padding:"5px 8px",
      background: done ? "rgba(74,222,128,0.04)" : "transparent",
      borderBottom:"1px solid #0f1f0f",
    }}>
      <span style={{fontSize:9,color:"#4a6a4a",fontFamily:"'Courier New',monospace"}}>S{setNum}</span>
      <span style={{fontSize:10,color:"#c8d4c8",fontFamily:"'Courier New',monospace"}}>{reps}r</span>
      <div>
        <div style={{fontSize:11,fontWeight:"bold",color: mult<1?"#facc15":"#6aaa6a",fontFamily:"'Courier New',monospace"}}>{displayLoad}</div>
        {rpe && <div style={{fontSize:8,color:"#3a5a3a",fontFamily:"'Courier New',monospace",marginTop:1}}>{rpe}</div>}
      </div>
      <input type="number" placeholder="actual lb" value={actual?.weight||""} disabled={mult===0}
        onChange={e=>onChange({...actual,weight:e.target.value})}
        style={{...BASE_INPUT,fontSize:11}} />
      <input type="text" placeholder="reps / RPE / note" value={actual?.note||""} disabled={mult===0}
        onChange={e=>onChange({...actual,note:e.target.value})}
        style={{...BASE_INPUT,fontSize:10}} />
      <button disabled={mult===0} onClick={()=>onChange({...actual,done:!done})} style={{
        background: done?"rgba(74,222,128,0.12)":"#0d130d",
        border:`1px solid ${done?"#4ade80":"#2d4a2d"}`,
        color: done?"#4ade80":"#4a6a4a",
        padding:"4px 0", cursor:mult===0?"default":"pointer", fontSize:9,
        letterSpacing:1, ...MONO,
      }}>{done?"✓ DONE":"LOG SET"}</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXERCISE CARD
// ─────────────────────────────────────────────────────────────────────────────
function ExerciseCard({ ex, exState, mult, tier, painBack, painShoulder, data, onSetUpdate, onMetaUpdate, onLogSession, onAdvanceStep }) {
  const [open, setOpen] = useState(true);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const stepIdx   = Math.min(exState.stepIdx, ex.progression.length - 1);
  const step      = ex.progression[stepIdx];
  const stepCount = ex.progression.length;
  const isFinalStep = stepIdx === stepCount - 1;
  const rows      = Array.from({ length: step.sets }, (_, i) => i);
  const doneCount = rows.filter(i => data[i]?.done).length;
  const allDone   = doneCount === step.sets;
  const sessionLogged = !!data.sessionLoggedAt;
  const topRPEInput   = data.topRPE ?? "";

  const stepHistory = exState.history.filter(h => h.stepIdx === stepIdx);
  const gateRes     = evaluateGate(step.gate, stepHistory);
  const showAdvance = gateRes.cleared && !isFinalStep;
  const blockGate   = isFinalStep && step.gate?.type === "PAIN_FREE_WEEKS";

  return (
    <div style={{
      border:`1px solid ${allDone?"#2d4a2d":"#1e321e"}`,
      background: allDone?"rgba(74,222,128,0.02)":"#0d130d",
      marginBottom:10,
    }}>
      <div onClick={()=>setOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",cursor:"pointer",borderBottom:open?"1px solid #1a2a1a":"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:12,fontWeight:"bold",letterSpacing:2,color:allDone?"#4ade80":"#c8d4c8",...MONO}}>
            {allDone?"✓ ":""}{ex.name}
          </span>
          <span style={{fontSize:8,color:"#4a6a4a",letterSpacing:1,...MONO}}>{doneCount}/{step.sets} SETS</span>
          <span style={{fontSize:9,color:"#4a6a4a",background:"#111a11",padding:"1px 6px",border:"1px solid #1e321e",...MONO}}>
            {step.sets}×{step.reps} @ {mult<1?scaleLoad(step.load,mult):step.load}
          </span>
          <span style={{fontSize:8,color:gateRes.cleared?"#4ade80":"#facc15",background:"#0a1a0a",padding:"1px 6px",border:`1px solid ${gateRes.cleared?"#2d4a2d":"#3a3a0a"}`,letterSpacing:1,...MONO}}>
            STEP {stepIdx+1}/{stepCount}{step.gate?` · ${gateRes.progress}`:" · MAINT"}
          </span>
        </div>
        <span style={{color:"#4a6a4a",fontSize:10,...MONO}}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div>
          {ex.cue && <div style={{padding:"5px 12px",fontSize:9,color:"#5a7a5a",letterSpacing:1,borderBottom:"1px solid #0f1f0f",...MONO}}>› {ex.cue}</div>}
          {step.gate && (
            <div style={{padding:"4px 12px",fontSize:8,color:gateRes.cleared?"#4ade80":"#7a9a7a",letterSpacing:1,borderBottom:"1px solid #0f1f0f",...MONO}}>
              GATE: {gateRes.note} {gateRes.cleared?" — CLEARED ✓":` — ${gateRes.progress}`}
              {blockGate && <span style={{color:"#facc15",marginLeft:6}}>· phase transition</span>}
            </div>
          )}
          {tier === "MODERATE" && <div style={{padding:"4px 12px",fontSize:8,color:"#facc15",borderBottom:"1px solid #0f1f0f",...MONO}}>MODERATE TIER — LOADS SCALED TO 80%</div>}
          {tier === "DELOAD"   && <div style={{padding:"4px 12px",fontSize:8,color:"#fb923c",borderBottom:"1px solid #0f1f0f",...MONO}}>DELOAD WEEK — LOADS SCALED TO 60% · SESSIONS DO NOT ADVANCE GATES</div>}
          <div style={{display:"grid",gridTemplateColumns:"26px 50px 1fr 85px 1fr 90px",gap:5,padding:"4px 8px 2px",fontSize:7,letterSpacing:2,color:"#2a4a2a",borderBottom:"1px solid #0f1f0f",...MONO}}>
            <span>SET</span><span>REPS</span><span>PRESCRIBED</span><span>ACTUAL LB</span><span>REPS/NOTE</span><span></span>
          </div>
          {rows.map(i=>(
            <SetRow key={i} setNum={i+1} reps={step.reps} load={step.load} rpe={step.rpe} mult={mult}
              actual={data[i]} onChange={v=>onSetUpdate(i,v)} />
          ))}

          {/* Session-complete: top-set RPE + log session */}
          {allDone && step.gate && !sessionLogged && (
            <div style={{padding:"8px 12px",borderTop:"1px solid #1a2a1a",background:"#0a1a0a"}}>
              <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
                <div style={{flex:"1 1 130px"}}>
                  <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:3,...MONO}}>TOP-SET RPE (1–10)</div>
                  <input type="number" min={1} max={10} step={0.5} value={topRPEInput}
                    onChange={e=>onMetaUpdate("topRPE", e.target.value)}
                    style={BASE_INPUT} placeholder="e.g. 7"/>
                </div>
                <button
                  disabled={topRPEInput === "" || mult === 0}
                  onClick={()=>onLogSession({
                    topRPE: Number(topRPEInput),
                    painBack, painShoulder, tier,
                  })}
                  style={{background:topRPEInput!==""?"#2d4a2d":"#1a2e1a",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"6px 14px",cursor:topRPEInput!==""?"pointer":"default",fontSize:8,letterSpacing:2,...MONO}}>
                  LOG SESSION →
                </button>
              </div>
              <div style={{fontSize:8,color:"#5a7a5a",letterSpacing:1,marginTop:6,...MONO}}>
                will stamp: back {painBack}/10 · shoulder {painShoulder}/10 — update on Readiness tab if these don't match how you felt during the session
              </div>
            </div>
          )}
          {sessionLogged && !showAdvance && step.gate && (
            <div style={{padding:"6px 12px",borderTop:"1px solid #1a2a1a",fontSize:9,color:"#7a9a7a",letterSpacing:1,...MONO}}>
              ✓ session logged @ RPE {data.topRPE} — gate progress {gateRes.progress} — {gateRes.cleared?"clear":"more sessions needed"}
            </div>
          )}
          {showAdvance && (
            <div style={{padding:"8px 12px",borderTop:"1px solid #2d4a2d",background:"rgba(74,222,128,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,color:"#4ade80",letterSpacing:1,...MONO}}>✓ GATE CLEARED — READY FOR STEP {stepIdx+2}/{stepCount}</span>
              <button onClick={onAdvanceStep} style={{background:"#1a2e1a",border:"1px solid #4ade80",color:"#4ade80",padding:"5px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>ADVANCE STEP →</button>
            </div>
          )}
          {!isFinalStep && !showAdvance && (
            confirmSkip ? (
              <div style={{padding:"10px 12px",borderTop:"1px solid #3a3a0a",background:"rgba(250,204,21,0.05)",...MONO}}>
                <div style={{fontSize:9,color:"#facc15",letterSpacing:2,marginBottom:6}}>
                  SKIP GATE — JUMP TO STEP {stepIdx+2}/{stepCount}?
                </div>
                <div style={{fontSize:8,color:"#9a9a6a",letterSpacing:1,marginBottom:8}}>
                  Bypasses this gate ({step.gate?gateRes.progress:"maintenance"}) without clearing the criteria and advances your saved progress to {ex.progression[stepIdx+1].sets}×{ex.progression[stepIdx+1].reps} {ex.progression[stepIdx+1].load}. Logged history stays on this step.
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{ onAdvanceStep(); setConfirmSkip(false); }}
                    style={{background:"#2e2a0a",border:"1px solid #facc15",color:"#facc15",padding:"5px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>
                    ⏭ CONFIRM SKIP
                  </button>
                  <button onClick={()=>setConfirmSkip(false)}
                    style={{background:"transparent",border:"1px solid #2d4a2d",color:"#4a6a4a",padding:"5px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>
                    CANCEL
                  </button>
                </div>
              </div>
            ) : (
              <div style={{padding:"6px 12px",borderTop:"1px solid #1a2a1a",display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>setConfirmSkip(true)}
                  style={{background:"transparent",border:"1px solid #3a3a0a",color:"#7a7a4a",padding:"4px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>
                  ⏭ SKIP GATE — ADVANCE TO STEP {stepIdx+2}/{stepCount}
                </button>
              </div>
            )
          )}
          {isFinalStep && gateRes.cleared && (
            <div style={{padding:"8px 12px",borderTop:"1px solid #2d4a2d",background:"rgba(250,204,21,0.05)",fontSize:9,color:"#facc15",letterSpacing:1,...MONO}}>
              ★ FINAL STEP CLEARED — anchor for block transition. Hold or graduate from header.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCKED EXERCISE PREVIEW — shown when block is not yet unlocked
// ─────────────────────────────────────────────────────────────────────────────
function LockedExerciseCard({ ex }) {
  const firstStep = ex.progression[0];
  return (
    <div style={{border:"1px dashed #3a3a0a",background:"rgba(250,204,21,0.02)",marginBottom:10,padding:"9px 12px",opacity:0.7}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:"bold",letterSpacing:2,color:"#facc15",...MONO}}>🔒 {ex.name}</span>
        <span style={{fontSize:7,color:"#facc15",background:"#1a1a0a",padding:"1px 6px",border:"1px solid #3a3a0a",letterSpacing:2,...MONO}}>BLOCK {ex.block} — LOCKED</span>
        {ex.replaces && <span style={{fontSize:7,color:"#7a7a4a",letterSpacing:1,...MONO}}>replaces {ex.replaces}</span>}
      </div>
      <div style={{fontSize:9,color:"#7a7a4a",marginTop:4,...MONO}}>› {ex.cue}</div>
      <div style={{fontSize:8,color:"#5a5a3a",marginTop:3,...MONO}}>STARTS @ {firstStep.sets}×{firstStep.reps} {firstStep.load} — {ex.progression.length} steps total</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
const initOura = { readiness:80, hrv:48, hrv7day:52, rhr:58, rhrBaseline:55 };

// ─── NUTRITION ───────────────────────────────────────────────────────────────
const NUTRITION_TARGETS = { cal:2900, protein:200, sodium:2500, water:100 };

// Saved meals library — pre-loaded with Quincy's repeating meals
const DEFAULT_SAVED_MEALS = [
  { id:"sm1", name:"Protein Shake",          cal:160,  protein:30, sodium:230,  fat:3,  carbs:8  },
  { id:"sm2", name:"Overnight Oats + Protein",cal:350, protein:36, sodium:410,  fat:8,  carbs:42 },
  { id:"sm3", name:"Teriyaki Mahi + Rice",    cal:700, protein:48, sodium:1000, fat:12, carbs:72 },
  { id:"sm4", name:"Garden of Life Protein",  cal:160, protein:30, sodium:230,  fat:3,  carbs:8  },
  { id:"sm5", name:"Almond Milk 10oz",        cal:40,  protein:1,  sodium:180,  fat:3,  carbs:2  },
];

function nutStatus(actual, target) {
  const pct = actual / target;
  if (pct >= 0.9)  return "#4ade80";
  if (pct >= 0.7)  return "#facc15";
  return "#f87171";
}

export default function App() {
  const [tab, setTab]         = useState("program");
  const { oura, setManualOverride, error: ouraError, loading: ouraLoading, refresh: refreshOura } = useOuraSync();
  const [ouraInput, setOuraInput] = useState({...initOura});
  const [showOuraForm, setShowOuraForm] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [calibrateInput, setCalibrateInput] = useState({});
  const [selDay, setSelDay]   = useState(todayKey());
  const [sessionData, setSessionData] = useState({});
  const [backPain, setBackPain] = useState(0);
  const [shoulderPain, setShoulderPain] = useState(0);

  // Persisted: per-exercise step state + current block + readiness history + deload
  const [stepState, setStepState] = useState(() => lsLoad(LS_STEP_STATE, {}));
  const [currentBlock, setCurrentBlock] = useState(() => lsLoad(LS_CURRENT_BLOCK, "A"));
  const [readinessHistory, setReadinessHistory] = useState(() => lsLoad(LS_READINESS_HISTORY, []));
  const [deloadState, setDeloadState] = useState(() => lsLoad(LS_DELOAD_STATE, { current:null, history:[] }));

  useEffect(()=>{ lsSave(LS_STEP_STATE, stepState); }, [stepState]);
  useEffect(()=>{ lsSave(LS_CURRENT_BLOCK, currentBlock); }, [currentBlock]);
  useEffect(()=>{ lsSave(LS_READINESS_HISTORY, readinessHistory); }, [readinessHistory]);
  useEffect(()=>{ lsSave(LS_DELOAD_STATE, deloadState); }, [deloadState]);

  // Auto-archive an expired `current` deload on mount so "weeks since last
  // break" doesn't reset to zero just because the user never clicked END EARLY.
  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeloadState(prev => archiveExpiredDeload(prev, todayISO()));
  }, []);

  // Snapshot today's readiness once per day. Functional setter no-ops if today's
  // snapshot is already current, so cascading renders are avoided.
  useEffect(()=>{
    if (!oura || oura.source === "manual") return;
    const today = todayISO();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadinessHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && last.date === today && last.readiness === oura.readiness && last.hrv === oura.hrv && last.rhr === oura.rhr) return prev;
      const filtered = prev.filter(d => d.date !== today);
      return [...filtered, { date:today, readiness:oura.readiness, hrv:oura.hrv, hrv7day:oura.hrv7day, rhr:oura.rhr, rhrBaseline:oura.rhrBaseline }].slice(-14);
    });
  }, [oura, oura.readiness, oura.hrv, oura.hrv7day, oura.rhr, oura.rhrBaseline, oura.source]);

  const [messages, setMessages] = useState([{ role:"assistant", content:"OPERATOR ONLINE. Metrics loaded. Give me something to work with." }]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const [logEntries, setLogEntries] = useState([]);
  const [logForm, setLogForm] = useState({ exercise:"", sets:"", reps:"", weight:"", notes:"" });
  const logDate = new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});

  // ── Nutrition state ────────────────────────────────────────────────────────
  const [savedMeals, setSavedMeals]   = useState(DEFAULT_SAVED_MEALS);
  const [foodLog, setFoodLog]         = useState([]);   // today's logged entries
  const [nutForm, setNutForm]         = useState({ name:"", cal:"", protein:"", sodium:"", fat:"", carbs:"" });
  const [waterOz, setWaterOz]         = useState(0);
  const [showNutForm, setShowNutForm] = useState(false);
  const [showSaved, setShowSaved]     = useState(false);
  const [photoDesc, setPhotoDesc]     = useState("");
  const [photoLoading, setPhotoLoading] = useState(false);
  const [showSaveMeal, setShowSaveMeal] = useState(false);

  // Nutrition totals
  const nutTotals = foodLog.reduce((acc, e) => ({
    cal:     acc.cal     + (Number(e.cal)     || 0),
    protein: acc.protein + (Number(e.protein) || 0),
    sodium:  acc.sodium  + (Number(e.sodium)  || 0),
    fat:     acc.fat     + (Number(e.fat)     || 0),
    carbs:   acc.carbs   + (Number(e.carbs)   || 0),
  }), { cal:0, protein:0, sodium:0, fat:0, carbs:0 });

  // Tier resolution priority: RECOVERY (Oura) > DELOAD (active) > HARD/MODERATE (Oura)
  const today        = todayISO();
  const activeDeload = getActiveDeload(deloadState, today);
  const baseTier     = getTier(oura.readiness);
  const tier         = baseTier === "RECOVERY" ? "RECOVERY"
                     : activeDeload             ? "DELOAD"
                     :                            baseTier;
  const tcfg         = TIER_CONFIG[tier];
  const mult         = tier==="HARD"     ? 1.0
                     : tier==="MODERATE" ? 0.8
                     : tier==="DELOAD"   ? DELOAD_LOAD_MULT
                     :                     0;
  const weeksSinceDeload   = weeksSinceLastDeload(deloadState, stepState, today);
  const shouldSuggestDeload = !activeDeload
                              && weeksSinceDeload !== null
                              && weeksSinceDeload >= DELOAD_SUGGEST_AFTER_WEEKS;
  const hrvAlert = getHRVAlert(oura.hrv7day, oura.hrv);
  const rhrAlert = getRHRAlert(oura.rhrBaseline, oura.rhr);
  const blockCfg = BLOCK_CONFIG[currentBlock];
  const deloadTriggers = evaluateDeloadTriggers(readinessHistory);
  const nextBlock = currentBlock === "A" ? "B" : currentBlock === "B" ? "C" : currentBlock === "C" ? "D" : null;
  const transitionAnchors = currentBlock === "A" ? BLOCK_TRANSITION_ANCHORS.A_TO_B
                          : currentBlock === "B" ? BLOCK_TRANSITION_ANCHORS.B_TO_C
                          : currentBlock === "C" ? BLOCK_TRANSITION_ANCHORS.C_TO_D : [];
  const blockAdvanceReady = nextBlock && transitionAnchors.length > 0 && isBlockTransitionReady(stepState, PROGRAM, transitionAnchors);

  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages,chatLoading]);

 function applyOura(){ setManualOverride({...ouraInput}); setShowOuraForm(false); }

  function updateSet(dayKey, exId, setIdx, val){
    setSessionData(prev=>({
      ...prev,
      [dayKey]:{...(prev[dayKey]||{}),
        [exId]:{...((prev[dayKey]||{})[exId]||{}),[setIdx]:val}
      }
    }));
  }

  function logSession(exId, payload){
    const today = todayISO();
    setStepState(prev => {
      const st = prev[exId] || { stepIdx:0, history:[] };
      const entry = {
        date: today,
        stepIdx: st.stepIdx,
        topRPE: payload.topRPE,
        painBack: payload.painBack ?? 0,
        painShoulder: payload.painShoulder ?? 0,
        tier: payload.tier ?? "HARD",
        completed: true,
      };
      // Replace today's entry if already logged for this step (idempotent on same day)
      const filtered = st.history.filter(h => !(h.date === today && h.stepIdx === st.stepIdx));
      return { ...prev, [exId]: { ...st, history: [...filtered, entry] } };
    });
    // Mark session-logged in sessionData so UI hides the input
    setSessionData(prev=>({
      ...prev,
      [selDay]:{...(prev[selDay]||{}),
        [exId]:{...((prev[selDay]||{})[exId]||{}), sessionLoggedAt: today, topRPE: payload.topRPE}
      }
    }));
  }

  function advanceStep(exId){
    setStepState(prev => {
      const st = prev[exId] || { stepIdx:0, history:[] };
      const ex = findExerciseById(PROGRAM, exId);
      const maxIdx = ex ? ex.progression.length - 1 : st.stepIdx;
      return { ...prev, [exId]: { ...st, stepIdx: Math.min(st.stepIdx + 1, maxIdx) } };
    });
    // Clear current-day session UI for this exercise so next session starts fresh
    setSessionData(prev=>{
      const day = {...(prev[selDay]||{})};
      delete day[exId];
      return {...prev, [selDay]: day};
    });
  }

  function getDayProgress(dk){
    const d = PROGRAM[dk];
    if(!d || !d.exercises || d.exercises.length===0) return null;
    const visible = getVisibleExercises(d.exercises, currentBlock);
    const total = visible.reduce((a, e)=>{
      const st   = getStepState(stepState, e.id);
      const step = e.progression[Math.min(st.stepIdx, e.progression.length-1)];
      return a + step.sets;
    }, 0);
    const done = visible.reduce((a, e)=>{
      const st   = getStepState(stepState, e.id);
      const step = e.progression[Math.min(st.stepIdx, e.progression.length-1)];
      const ed   = (sessionData[dk]||{})[e.id]||{};
      return a + Array.from({length:step.sets},(_,i)=>i).filter(i=>ed[i]?.done).length;
    }, 0);
    return {done, total};
  }

  async function sendMessage(){
    if(!chatInput.trim()||chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    const nutCtx = `[NUTRITION TODAY: ${nutTotals.cal}cal / ${nutTotals.protein}g protein / ${nutTotals.sodium}mg sodium / ${waterOz}oz water — targets: ${NUTRITION_TARGETS.cal}cal / ${NUTRITION_TARGETS.protein}g protein / ${NUTRITION_TARGETS.sodium}mg sodium / ${NUTRITION_TARGETS.water}oz — meals: ${foodLog.length>0?foodLog.map(f=>f.name).join(", "):"none logged"}]`;
    const deloadCtx = activeDeload
      ? `, ACTIVE DELOAD: day ${(DELOAD_DURATION_DAYS - activeDeload.daysRemaining + 1)} of ${DELOAD_DURATION_DAYS} (ends ${activeDeload.endsOn})`
      : (weeksSinceDeload !== null ? `, ${weeksSinceDeload}w since last deload` : "");
    const ctx = `[OURA: Readiness ${oura.readiness}, HRV ${oura.hrv}ms (7d avg: ${oura.hrv7day}ms), RHR ${oura.rhr}bpm (baseline: ${oura.rhrBaseline}bpm), Tier: ${tier}, Block: ${currentBlock} (${blockLabel(currentBlock)}), Back Pain: ${backPain}/10, Shoulder Pain: ${shoulderPain}/10${deloadCtx}${deloadTriggers.length?`, DELOAD TRIGGERS: ${deloadTriggers.join("; ")}`:""}]\n${nutCtx}\n\n${userMsg}`;
    const newMsgs = [...messages, {role:"user",content:userMsg}];
    setMessages(newMsgs);
    setChatLoading(true);
    try {
      const apiMsgs = newMsgs.slice(1).map((m,i)=>
        i===newMsgs.length-2 ? {role:"user",content:ctx} : {role:m.role,content:m.content}
      );
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST", headers:{"Content-Type":"application/json","anthropic-version":"2023-06-01","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY},
        body:JSON.stringify({ model:"claude-opus-4-7", max_tokens:1000, system:SYSTEM_PROMPT, messages:apiMsgs })
      });
      const data = await res.json();
      setMessages(prev=>[...prev,{role:"assistant",content:data.content?.map(b=>b.text||"").join("")||"No response."}]);
    } catch { setMessages(prev=>[...prev,{role:"assistant",content:"COMMS ERROR."}]); }
    setChatLoading(false);
  }

  const day  = PROGRAM[selDay];
  const prog = getDayProgress(selDay)

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{...MONO, background:"#0a0f0a", color:"#c8d4c8", minHeight:"100vh", display:"flex", flexDirection:"column"}}>

      {/* HEADER */}
      <header style={{borderBottom:"2px solid #2d4a2d",padding:"10px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#0d130d"}}>
        <div>
          <div style={{color:"#6aaa6a",fontSize:8,letterSpacing:4,marginBottom:1}}>SQUAREBUSH SERVICES</div>
          <div style={{color:"#c8d4c8",fontSize:13,fontWeight:"bold",letterSpacing:3}}>STRENGTH OPS // LONGEVITY UNIT</div>
        </div>
        <div style={{display:"flex",gap:20,alignItems:"center"}}>
          {/* Block badge + transition trigger */}
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:7,color:"#4a6a4a",letterSpacing:2,marginBottom:3}}>MACRO BLOCK</div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{fontSize:14,fontWeight:"bold",color:blockCfg.color,letterSpacing:3}}>{currentBlock}</div>
              <div style={{fontSize:7,color:"#3a5a3a",letterSpacing:1}}>{blockCfg.name}</div>
              {blockAdvanceReady && nextBlock && !showBlockConfirm && (
                <button onClick={()=>setShowBlockConfirm(true)}
                  style={{marginTop:4,background:"#1a2e1a",border:"1px solid #4ade80",color:"#4ade80",padding:"3px 8px",cursor:"pointer",fontSize:7,letterSpacing:2,...MONO}}>
                  ▲ ADVANCE → {nextBlock}
                </button>
              )}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:7,color:"#6aaa6a",letterSpacing:2}}>STATUS</div>
            <div style={{color:tcfg.color,fontSize:11,fontWeight:"bold",letterSpacing:2}}>{tcfg.label}</div>
            <div style={{color:"#4a6a4a",fontSize:7,letterSpacing:1,marginTop:1}}>R:{oura.readiness} HRV:{oura.hrv} RHR:{oura.rhr}</div>
            <div style={{fontSize:7,letterSpacing:2,marginTop:2,color:OURA_SOURCE_COLOR[oura.source]||"#4a6a4a"}}>
              SRC:{OURA_SOURCE_LABEL[oura.source]||String(oura.source||"?").toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      {/* ALERTS */}
      {ouraError && (
        <div style={{background:"rgba(248,113,113,0.08)",borderBottom:"1px solid #3a1a1a",padding:"4px 18px",fontSize:9,color:"#f87171",letterSpacing:1,display:"flex",gap:10,alignItems:"center",justifyContent:"space-between"}}>
          <span>⚠ OURA SYNC FAILED: {ouraError} — showing {OURA_SOURCE_LABEL[oura.source]||oura.source} data</span>
          <button onClick={refreshOura} disabled={ouraLoading} style={{background:"transparent",border:"1px solid #f87171",color:"#f87171",padding:"2px 8px",cursor:ouraLoading?"default":"pointer",fontSize:8,letterSpacing:2,...MONO}}>
            {ouraLoading?"…":"RETRY"}
          </button>
        </div>
      )}
      {(hrvAlert||rhrAlert) && (
        <div style={{background:"#0a0a0a",borderBottom:"1px solid #3a1a1a"}}>
          {[hrvAlert,rhrAlert].filter(Boolean).map((a,i)=>(
            <div key={i} style={{padding:"4px 18px",fontSize:9,color:"#f87171",letterSpacing:1,display:"flex",gap:8}}>⚠ {a}</div>
          ))}
        </div>
      )}
      {deloadTriggers.length > 0 && (
        <div style={{background:"rgba(248,113,113,0.06)",borderBottom:"1px solid #3a1a1a",padding:"4px 18px",fontSize:9,color:"#f87171",letterSpacing:2}}>
          {deloadTriggers.map((t,i) => <div key={i}>⚠ AUTO-DELOAD TRIGGER: {t}</div>)}
        </div>
      )}
      {activeDeload && (
        <div style={{background:"rgba(251,146,60,0.08)",borderBottom:"1px solid #5a3a1a",padding:"4px 18px",fontSize:9,color:"#fb923c",letterSpacing:2,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>
            ⌖ DELOADING — {activeDeload.daysRemaining} day{activeDeload.daysRemaining===1?"":"s"} remaining · sessions do NOT count toward gates
            {tier === "RECOVERY"
              ? " · RECOVERY OVERRIDE — readiness <70, no loading today"
              : " · loads at 60%"}
          </span>
          <button onClick={()=>setDeloadState(prev=>endDeload(prev, todayISO()))}
            style={{background:"transparent",border:"1px solid #fb923c",color:"#fb923c",padding:"2px 8px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>
            END EARLY
          </button>
        </div>
      )}
      {shouldSuggestDeload && (
        <div style={{background:"rgba(250,204,21,0.06)",borderBottom:"1px solid #3a3a0a",padding:"4px 18px",fontSize:9,color:"#facc15",letterSpacing:2,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>⚠ Consider a deload week — {weeksSinceDeload} weeks since your last break</span>
          <button onClick={()=>setDeloadState(prev=>({ current:startDeload(todayISO()), history:prev?.history||[] }))}
            style={{background:"#1a2e1a",border:"1px solid #facc15",color:"#facc15",padding:"2px 8px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>
            START DELOAD
          </button>
        </div>
      )}
      {blockAdvanceReady && nextBlock && !showBlockConfirm && (
        <div style={{background:"rgba(74,222,128,0.04)",borderBottom:"1px solid #2d4a2d",padding:"4px 18px",fontSize:9,color:"#4ade80",letterSpacing:2}}>
          ✓ BLOCK {currentBlock} ANCHORS CLEARED — READY TO ADVANCE TO BLOCK {nextBlock}. Use header button when you're ready.
        </div>
      )}
      {showBlockConfirm && nextBlock && (
        <div style={{background:"#0d130d",borderBottom:"1px solid #2d4a2d",padding:"10px 18px",...MONO}}>
          <div style={{fontSize:9,color:"#4ade80",letterSpacing:2,marginBottom:6}}>
            CONFIRM BLOCK ADVANCE: {currentBlock} → {nextBlock}
          </div>
          <div style={{fontSize:9,color:"#7a9a7a",marginBottom:5}}>
            Anchors cleared: {transitionAnchors.join(", ")}
          </div>
          <div style={{fontSize:9,color:"#9aba9a",marginBottom:8}}>
            BLOCK {nextBlock} — {BLOCK_CONFIG[nextBlock].name}: {BLOCK_CONFIG[nextBlock].desc}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{ setCurrentBlock(nextBlock); setShowBlockConfirm(false); }}
              style={{background:"#1a2e1a",border:"1px solid #4ade80",color:"#4ade80",padding:"5px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>
              ▲ CONFIRM ADVANCE
            </button>
            <button onClick={()=>setShowBlockConfirm(false)}
              style={{background:"transparent",border:"1px solid #2d4a2d",color:"#4a6a4a",padding:"5px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* NAV */}
      <nav style={{display:"flex",borderBottom:"1px solid #1e321e",background:"#0d130d",overflowX:"auto"}}>
        {[["dashboard","01 READINESS"],["program","02 PROGRAM"],["nutrition","03 NUTRITION"],["chat","04 COACH AI"],["log","05 LOG"]].map(([k,lbl])=>(
          <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?"#1a2e1a":"transparent",color:tab===k?"#6aaa6a":"#4a6a4a",border:"none",borderBottom:tab===k?"2px solid #6aaa6a":"2px solid transparent",padding:"8px 14px",cursor:"pointer",fontSize:9,letterSpacing:3,...MONO,whiteSpace:"nowrap"}}>{lbl}</button>
        ))}
      </nav>

      <main style={{flex:1,padding:"14px 16px",maxWidth:980,width:"100%",margin:"0 auto",boxSizing:"border-box"}}>

        {/* ══ 01 READINESS ═══════════════════════════════════════════════════ */}
        {tab==="dashboard"&&(
          <div>
            <div style={{border:`1px solid ${tcfg.border}`,background:tcfg.bg,padding:"14px 18px",marginBottom:14}}>
              <div style={{fontSize:8,letterSpacing:4,color:"#6aaa6a",marginBottom:4}}>TODAY'S DIRECTIVE</div>
              <div style={{fontSize:22,fontWeight:"bold",color:tcfg.color,letterSpacing:4,marginBottom:3}}>{tcfg.label}</div>
              <div style={{fontSize:8,color:"#7a9a7a",letterSpacing:2}}>{tcfg.range}</div>
              <div style={{fontSize:11,color:"#c8d4c8",marginTop:6}}>{tcfg.desc}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:7,marginBottom:14}}>
              {[
                {label:"READINESS",value:oura.readiness,unit:"/100",color:oura.readiness>=85?"#4ade80":oura.readiness>=70?"#facc15":"#f87171"},
                {label:"HRV",value:oura.hrv,unit:"ms",color:"#c8d4c8"},
                {label:"HRV 7-DAY",value:oura.hrv7day,unit:"ms",color:"#c8d4c8"},
                {label:"RHR TODAY",value:oura.rhr,unit:"bpm",color:(oura.rhr-oura.rhrBaseline)>=5?"#f87171":"#c8d4c8"},
                {label:"RHR BASE",value:oura.rhrBaseline,unit:"bpm",color:"#c8d4c8"},
                {label:"BACK PAIN",value:backPain,unit:"/10",color:backPain>=3?"#f87171":backPain>=1?"#facc15":"#4ade80"},
                {label:"SHOULDER PAIN",value:shoulderPain,unit:"/10",color:shoulderPain>=3?"#f87171":shoulderPain>=1?"#facc15":"#4ade80"},
              ].map(m=>(
                <div key={m.label} style={{background:"#0d130d",border:"1px solid #1e321e",padding:"9px 10px"}}>
                  <div style={{fontSize:7,letterSpacing:3,color:"#4a6a4a",marginBottom:4}}>{m.label}</div>
                  <div style={{fontSize:18,fontWeight:"bold",color:m.color}}>{m.value}<span style={{fontSize:8,color:"#4a6a4a",marginLeft:2}}>{m.unit}</span></div>
                </div>
              ))}
            </div>
            <button onClick={()=>setShowOuraForm(v=>!v)} style={{background:"#1a2e1a",border:"1px solid #2d4a2d",color:"#6aaa6a",padding:"5px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO,marginBottom:8}}>
              {showOuraForm?"▲ CLOSE":"▼ UPDATE METRICS"}
            </button>
            {showOuraForm&&(
              <div style={{background:"#0d130d",border:"1px solid #2d4a2d",padding:12,marginBottom:12}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:7,marginBottom:10}}>
                  {[{key:"readiness",label:"READINESS"},{key:"hrv",label:"HRV TODAY (ms)"},{key:"hrv7day",label:"HRV 7-DAY (ms)"},{key:"rhr",label:"RHR TODAY (bpm)"},{key:"rhrBaseline",label:"RHR BASELINE (bpm)"}].map(f=>(
                    <div key={f.key}>
                      <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:3}}>{f.label}</div>
                      <input type="number" value={ouraInput[f.key]} onChange={e=>setOuraInput(p=>({...p,[f.key]:Number(e.target.value)}))} style={BASE_INPUT} />
                    </div>
                  ))}
                  <div>
                    <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:3}}>BACK PAIN (0–10)</div>
                    <input type="number" min={0} max={10} value={backPain} onChange={e=>setBackPain(Number(e.target.value))} style={BASE_INPUT} />
                  </div>
                  <div>
                    <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:3}}>SHOULDER PAIN (0–10)</div>
                    <input type="number" min={0} max={10} value={shoulderPain} onChange={e=>setShoulderPain(Number(e.target.value))} style={BASE_INPUT} />
                  </div>
                </div>
                <button onClick={applyOura} style={{background:"#1a2e1a",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"5px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>APPLY →</button>
              </div>
            )}

            {/* Deload toggle */}
            <div style={{marginBottom:8,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              {!activeDeload ? (
                <>
                  <button onClick={()=>setDeloadState(prev=>({ current:startDeload(todayISO()), history:prev?.history||[] }))}
                    style={{background:"#1a2e1a",border:"1px solid #fb923c",color:"#fb923c",padding:"5px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>
                    ▼ START DELOAD WEEK
                  </button>
                  <span style={{fontSize:8,color:"#7a7a4a",letterSpacing:1,...MONO}}>
                    {DELOAD_DURATION_DAYS} days · loads at {Math.round(DELOAD_LOAD_MULT*100)}% · RPE cap 6 · sessions do NOT count toward gates
                    {weeksSinceDeload !== null ? ` · ${weeksSinceDeload}w since last break` : ""}
                  </span>
                </>
              ) : (
                <>
                  <button onClick={()=>setDeloadState(prev=>endDeload(prev, todayISO()))}
                    style={{background:"#1a2e1a",border:"1px solid #fb923c",color:"#fb923c",padding:"5px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>
                    ▲ END DELOAD EARLY
                  </button>
                  <span style={{fontSize:8,color:"#fb923c",letterSpacing:1,...MONO}}>
                    DELOADING · {activeDeload.daysRemaining} day{activeDeload.daysRemaining===1?"":"s"} remaining (ends {activeDeload.endsOn})
                  </span>
                </>
              )}
            </div>

            {/* Program calibration */}
            <button onClick={()=>setShowCalibrate(v=>!v)} style={{background:"#1a2e1a",border:"1px solid #2d4a2d",color:"#6aaa6a",padding:"5px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO,marginBottom:8}}>
              {showCalibrate?"▲ CLOSE":"▼ CALIBRATE PROGRAM TO CURRENT LIFTS"}
            </button>
            {showCalibrate && (
              <div style={{background:"#0d130d",border:"1px solid #2d4a2d",padding:12,marginBottom:12}}>
                <div style={{fontSize:9,color:"#7a9a7a",letterSpacing:1,marginBottom:10,...MONO}}>
                  Enter your current TOP WORKING SET — what you can do for the prescribed sets×reps at RPE
                  ~7–8. NOT a 1-rep max. Leave blank if unsure. Program will jump each filled exercise to
                  the closest progression step and reset that step's gate.
                </div>
                {DAY_ORDER.map(dk=>{
                  const dDay = PROGRAM[dk];
                  if (!dDay.exercises) return null;
                  const visible = getVisibleExercises(dDay.exercises, currentBlock);
                  if (visible.length === 0) return null;
                  return (
                    <div key={dk} style={{marginBottom:10}}>
                      <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:5}}>{dDay.label}</div>
                      {visible.map(ex=>{
                        const st = getStepState(stepState, ex.id);
                        const curStep = ex.progression[Math.min(st.stepIdx, ex.progression.length-1)];
                        return (
                          <div key={ex.id} style={{display:"grid",gridTemplateColumns:"1.6fr 70px 1fr 110px",gap:8,alignItems:"center",padding:"3px 0",borderBottom:"1px solid #0f1f0f"}}>
                            <div style={{fontSize:10,color:"#c8d4c8",...MONO}}>{ex.name}</div>
                            <div style={{fontSize:8,color:"#4a6a4a",letterSpacing:1,...MONO}}>{st.stepIdx+1}/{ex.progression.length}</div>
                            <div style={{fontSize:9,color:"#6aaa6a",...MONO}}>now: {curStep.sets}×{curStep.reps} @ {curStep.load}</div>
                            <input type="number" placeholder="current lb" min={0}
                              value={calibrateInput[ex.id] ?? ""}
                              onChange={e=>setCalibrateInput(p=>({...p,[ex.id]:e.target.value}))}
                              style={BASE_INPUT} />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                <div style={{display:"flex",gap:8,marginTop:6}}>
                  <button onClick={()=>{
                    const filled = Object.fromEntries(
                      Object.entries(calibrateInput).filter(([,v])=>v !== "" && v !== null && v !== undefined)
                    );
                    if (Object.keys(filled).length === 0) { setShowCalibrate(false); return; }
                    setStepState(prev=>applyCalibration(prev, PROGRAM, filled));
                    setCalibrateInput({});
                    setShowCalibrate(false);
                  }} style={{background:"#1a2e1a",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"6px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>
                    APPLY CALIBRATION →
                  </button>
                  <button onClick={()=>setCalibrateInput({})}
                    style={{background:"transparent",border:"1px solid #2d4a2d",color:"#4a6a4a",padding:"6px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>
                    CLEAR
                  </button>
                </div>
              </div>
            )}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[
                {title:"DAILY NON-NEGOTIABLES",items:["Creatine 3–5g with food","First meal: 40–50g protein","Total: ≥1g protein / lb bodyweight","Zone 2 cap: ~133 bpm"]},
                {title:"SPINE PROTOCOL (McGill)",items:["McGill Big 3 before any loading","No spinal flexion under load","Hip hinge — not lumbar hinge","Brace before every rep, every set"]},
              ].map(p=>(
                <div key={p.title} style={{background:"#0d130d",border:"1px solid #1e321e",padding:"10px 12px"}}>
                  <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:6}}>{p.title}</div>
                  {p.items.map(item=>(
                    <div key={item} style={{fontSize:10,color:"#c8d4c8",padding:"3px 0",borderBottom:"1px solid #0f1f0f",display:"flex",gap:6}}>
                      <span style={{color:"#4a6a4a"}}>›</span>{item}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ 02 PROGRAM ═════════════════════════════════════════════════════ */}
        {tab==="program"&&(
          <div>
            {/* Tier + week banner */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,padding:"7px 12px",background:tcfg.bg,border:`1px solid ${tcfg.border}`}}>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <span style={{color:tcfg.color,fontSize:11,fontWeight:"bold",letterSpacing:2}}>{tcfg.label}</span>
                <span style={{color:"#4a6a4a",fontSize:9}}>—</span>
                <span style={{color:"#9aba9a",fontSize:9}}>
                  {tier==="RECOVERY"?"NO LOADING. ZONE 2 + MOBILITY ONLY.":
                   tier==="DELOAD"  ?"60% LOADS · RPE CAP 6 · SESSIONS DON'T COUNT":
                   tier==="MODERATE"?"80% LOADS — RPE TARGETS STILL APPLY":
                                     "FULL PROGRAM — HIT YOUR NUMBERS"}
                </span>
              </div>
              <span style={{fontSize:9,color:blockCfg.color,letterSpacing:2,fontWeight:"bold"}}>{blockLabel(currentBlock)}</span>
            </div>

            {/* Day tabs */}
            <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
              {DAY_ORDER.map(dk=>{
                const d=PROGRAM[dk];
                const p=getDayProgress(dk);
                const isToday=dk===todayKey();
                const isSel=dk===selDay;
                const pct=p&&p.total>0?Math.round((p.done/p.total)*100):null;
                return(
                  <button key={dk} onClick={()=>setSelDay(dk)} style={{background:isSel?"#1a2e1a":"#0d130d",border:`1px solid ${isSel?"#6aaa6a":isToday?"#3a5a3a":"#1e321e"}`,color:isSel?"#6aaa6a":isToday?"#9aba9a":"#4a6a4a",padding:"7px 9px",cursor:"pointer",...MONO,textAlign:"center",minWidth:58}}>
                    <div style={{fontSize:8,letterSpacing:2,marginBottom:2}}>{isToday?"●":""} {dk}</div>
                    <div style={{fontSize:7,color:isSel?"#4a8a4a":"#3a5a3a"}}>
                      {d.type.includes("lift")?(pct!==null&&pct>0?`${pct}% done`:"LIFT"):d.type==="cardio"?"CARDIO":"REST"}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Day header */}
            <div style={{borderBottom:"2px solid #2d4a2d",paddingBottom:8,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
              <div>
                <div style={{fontSize:8,letterSpacing:4,color:"#6aaa6a"}}>{day.label}</div>
                <div style={{fontSize:14,fontWeight:"bold",letterSpacing:2,color:"#c8d4c8",marginTop:2}}>{day.focus}</div>
                {day.note&&<div style={{fontSize:9,color:"#5a7a5a",marginTop:3}}>› {day.note}</div>}
              </div>
              {prog&&(
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:7,color:"#4a6a4a",letterSpacing:2}}>PROGRESS</div>
                  <div style={{fontSize:14,fontWeight:"bold",color:prog.done===prog.total&&prog.total>0?"#4ade80":"#facc15"}}>
                    {prog.done}<span style={{fontSize:8,color:"#4a6a4a"}}>/{prog.total}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Cardio only day */}
            {day.type==="cardio"&&(
              <div>
                {day.cardio.map((c,i)=>(
                  <div key={i} style={{background:"#0d130d",border:"1px solid #1e321e",padding:"11px 14px",marginBottom:7}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                      <span style={{fontSize:12,fontWeight:"bold",letterSpacing:1,color:"#c8d4c8"}}>{c.name}</span>
                      <span style={{fontSize:9,color:"#6aaa6a",letterSpacing:1}}>{c.duration}</span>
                    </div>
                    <div style={{fontSize:10,color:"#facc15",marginBottom:2}}>{c.target}</div>
                    {c.note&&<div style={{fontSize:9,color:"#5a7a5a"}}>› {c.note}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Lift or lift+cardio day */}
            {day.type.includes("lift")&&(
              <div>
                {/* Warm-up */}
                {day.warmup&&day.warmup.length>0&&(
                  <div style={{background:"#0d130d",border:"1px solid #1e321e",padding:"9px 12px",marginBottom:10}}>
                    <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:5}}>WARM-UP SEQUENCE</div>
                    {day.warmup.map((w,i)=>(
                      <div key={i} style={{fontSize:10,color:"#7a9a7a",padding:"2px 0",display:"flex",gap:7}}>
                        <span style={{color:"#3a5a3a"}}>{i+1}.</span>{w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tier warning */}
                {tier==="MODERATE"&&<div style={{fontSize:8,color:"#facc15",letterSpacing:1,marginBottom:8,padding:"5px 9px",background:"rgba(250,204,21,0.05)",border:"1px solid rgba(250,204,21,0.15)"}}>⚠ MODERATE DAY — ALL LOADS AT 80%. RPE TARGETS STILL APPLY. DO NOT GRIND.</div>}
                {tier==="DELOAD"&&<div style={{fontSize:8,color:"#fb923c",letterSpacing:1,marginBottom:8,padding:"5px 9px",background:"rgba(251,146,60,0.05)",border:"1px solid rgba(251,146,60,0.15)"}}>⌖ DELOAD WEEK — LOADS AT 60%. RPE CAP 6. SESSIONS DO NOT ADVANCE GATES.</div>}
                {tier==="RECOVERY"&&<div style={{fontSize:8,color:"#f87171",letterSpacing:1,marginBottom:8,padding:"5px 9px",background:"rgba(248,113,113,0.05)",border:"1px solid rgba(248,113,113,0.15)"}}>✕ RECOVERY DAY — NO LOADING. ZONE 2 CARDIO AND MCGILL BIG 3 ONLY.</div>}

                {/* Exercises — visible (unlocked) */}
                {tier!=="RECOVERY"&&getVisibleExercises(day.exercises, currentBlock).map(ex=>(
                  <ExerciseCard key={ex.id} ex={ex}
                    exState={getStepState(stepState, ex.id)}
                    mult={mult} tier={tier} painBack={backPain} painShoulder={shoulderPain}
                    data={(sessionData[selDay]||{})[ex.id]||{}}
                    onSetUpdate={(si, val)=> updateSet(selDay, ex.id, si, val)}
                    onMetaUpdate={(key, val)=> setSessionData(prev=>{
                      const day = prev[selDay] || {};
                      const exData = day[ex.id] || {};
                      return { ...prev, [selDay]: { ...day, [ex.id]: { ...exData, [key]: val } } };
                    })}
                    onLogSession={(payload)=>logSession(ex.id, payload)}
                    onAdvanceStep={()=>advanceStep(ex.id)}
                  />
                ))}

                {/* Locked preview — upcoming block */}
                {tier!=="RECOVERY" && getLockedPreview(day.exercises, currentBlock).length > 0 && (
                  <div style={{marginTop:14}}>
                    <div style={{fontSize:7,letterSpacing:3,color:"#7a7a4a",marginBottom:7}}>LOCKED — UNLOCKS WHEN BLOCK ADVANCES</div>
                    {getLockedPreview(day.exercises, currentBlock).map(ex=>(
                      <LockedExerciseCard key={ex.id} ex={ex} />
                    ))}
                  </div>
                )}

                {/* Cardio block */}
                {day.cardio&&day.cardio.length>0&&(
                  <div style={{marginTop:14}}>
                    <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:7}}>CARDIO BLOCK</div>
                    {day.cardio.map((c,i)=>(
                      <div key={i} style={{background:"#0d130d",border:"1px solid #1e321e",padding:"10px 12px",marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                          <span style={{fontSize:11,fontWeight:"bold",letterSpacing:1,color:"#c8d4c8"}}>{c.name}</span>
                          <span style={{fontSize:9,color:"#6aaa6a"}}>{c.duration}</span>
                        </div>
                        <div style={{fontSize:10,color:"#facc15",marginBottom:1}}>{c.target}</div>
                        {c.note&&<div style={{fontSize:9,color:"#5a7a5a"}}>› {c.note}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Session complete */}
                {prog&&prog.done===prog.total&&prog.total>0&&(
                  <div style={{textAlign:"center",padding:"16px",border:"1px solid #4ade80",background:"rgba(74,222,128,0.03)",marginTop:8}}>
                    <div style={{fontSize:12,color:"#4ade80",letterSpacing:4,fontWeight:"bold"}}>✓ LIFTING COMPLETE</div>
                    <div style={{fontSize:8,color:"#4a8a4a",marginTop:4,letterSpacing:1}}>HIT YOUR CARDIO BLOCK. LOG IN TAB 04.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ 03 NUTRITION ════════════════════════════════════════════════════ */}
        {tab==="nutrition"&&(
          <div>
            <div style={{fontSize:7,letterSpacing:3,color:"#4a6a4a",marginBottom:12}}>NUTRITION OPS // {logDate} // TARGET: {NUTRITION_TARGETS.cal}cal / {NUTRITION_TARGETS.protein}g protein</div>

            {/* ── Totals dashboard ── */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:7,marginBottom:14}}>
              {[
                {label:"CALORIES",   val:nutTotals.cal,     target:NUTRITION_TARGETS.cal,     unit:"cal"},
                {label:"PROTEIN",    val:nutTotals.protein,  target:NUTRITION_TARGETS.protein,  unit:"g"},
                {label:"SODIUM",     val:nutTotals.sodium,   target:NUTRITION_TARGETS.sodium,   unit:"mg"},
                {label:"WATER",      val:waterOz,            target:NUTRITION_TARGETS.water,    unit:"oz"},
                {label:"FAT",        val:nutTotals.fat,      target:null,                       unit:"g"},
                {label:"CARBS",      val:nutTotals.carbs,    target:null,                       unit:"g"},
              ].map(m=>{
                const color = m.target ? nutStatus(m.val, m.target) : "#c8d4c8";
                const pct   = m.target ? Math.min(100, Math.round((m.val/m.target)*100)) : null;
                return(
                  <div key={m.label} style={{background:"#0d130d",border:`1px solid ${m.target&&m.val<m.target*0.7?"#3a1a1a":"#1e321e"}`,padding:"9px 10px"}}>
                    <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:4}}>{m.label}</div>
                    <div style={{fontSize:17,fontWeight:"bold",color}}>{m.val}<span style={{fontSize:8,color:"#4a6a4a",marginLeft:2}}>{m.unit}</span></div>
                    {m.target&&<div style={{fontSize:7,color:"#3a5a3a",marginTop:3}}>{pct}% of {m.target}{m.unit}</div>}
                    {m.target&&(
                      <div style={{height:2,background:"#1a2a1a",marginTop:4}}>
                        <div style={{height:2,background:color,width:`${pct}%`,transition:"width 0.3s"}}/>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Alerts ── */}
            {nutTotals.cal < NUTRITION_TARGETS.cal * 0.7 && (
              <div style={{padding:"6px 10px",background:"rgba(248,113,113,0.07)",border:"1px solid #f87171",fontSize:9,color:"#f87171",letterSpacing:1,marginBottom:10}}>
                ⚠ CALORIE DEFICIT — {NUTRITION_TARGETS.cal - nutTotals.cal} cal short of training day minimum. HR spike + fatigue risk.
              </div>
            )}
            {nutTotals.protein < NUTRITION_TARGETS.protein * 0.8 && (
              <div style={{padding:"6px 10px",background:"rgba(248,113,113,0.07)",border:"1px solid #f87171",fontSize:9,color:"#f87171",letterSpacing:1,marginBottom:10}}>
                ⚠ PROTEIN LOW — {NUTRITION_TARGETS.protein - nutTotals.protein}g short. Sarcopenia risk. Add a shake.
              </div>
            )}
            {nutTotals.sodium < 1800 && nutTotals.cal > 500 && (
              <div style={{padding:"6px 10px",background:"rgba(250,204,21,0.06)",border:"1px solid #facc15",fontSize:9,color:"#facc15",letterSpacing:1,marginBottom:10}}>
                ⚠ SODIUM LOW — {NUTRITION_TARGETS.sodium - nutTotals.sodium}mg short. Add electrolytes — elevated RHR risk.
              </div>
            )}

            {/* ── Water tracker ── */}
            <div style={{background:"#0d130d",border:"1px solid #1e321e",padding:"10px 12px",marginBottom:12}}>
              <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:8}}>WATER INTAKE</div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {[8,16,24,32].map(oz=>(
                  <button key={oz} onClick={()=>setWaterOz(w=>w+oz)} style={{background:"#1a2e1a",border:"1px solid #2d4a2d",color:"#6aaa6a",padding:"5px 10px",cursor:"pointer",fontSize:9,letterSpacing:1,...MONO}}>+{oz}oz</button>
                ))}
                <span style={{fontSize:11,color:"#c8d4c8",marginLeft:4}}>{waterOz}oz logged</span>
                {waterOz>0&&<button onClick={()=>setWaterOz(0)} style={{background:"transparent",border:"none",color:"#4a3030",cursor:"pointer",fontSize:10,...MONO}}>reset</button>}
              </div>
            </div>

            {/* ── Saved meals quick-add ── */}
            <div style={{marginBottom:12}}>
              <button onClick={()=>setShowSaved(v=>!v)} style={{background:"#1a2e1a",border:"1px solid #2d4a2d",color:"#6aaa6a",padding:"6px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO,marginBottom:showSaved?8:0}}>
                {showSaved?"▲ CLOSE":"▼ SAVED MEALS — QUICK ADD"}
              </button>
              {showSaved&&(
                <div style={{background:"#0d130d",border:"1px solid #1e321e",padding:10}}>
                  <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:8}}>TAP TO ADD TO TODAY'S LOG</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {savedMeals.map(m=>(
                      <div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",background:"#111a11",border:"1px solid #1e321e"}}>
                        <div>
                          <div style={{fontSize:11,color:"#c8d4c8",marginBottom:2}}>{m.name}</div>
                          <div style={{fontSize:8,color:"#4a6a4a",letterSpacing:1}}>{m.cal}cal · {m.protein}g pro · {m.sodium}mg Na</div>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>setFoodLog(p=>[...p,{...m,id:Date.now()}])} style={{background:"#1a2e1a",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"4px 10px",cursor:"pointer",fontSize:9,...MONO}}>+ ADD</button>
                          <button onClick={()=>setSavedMeals(p=>p.filter(x=>x.id!==m.id))} style={{background:"transparent",border:"none",color:"#4a3030",cursor:"pointer",fontSize:11}}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Photo / description AI parse ── */}
            <div style={{background:"#0d130d",border:"1px solid #1e321e",padding:12,marginBottom:12}}>
              <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:8}}>AI MEAL PARSER — DESCRIBE OR PASTE PHOTO DESCRIPTION</div>
              <textarea
                value={photoDesc}
                onChange={e=>setPhotoDesc(e.target.value)}
                placeholder={"Describe what you ate — e.g. 'grilled chicken breast 6oz, white rice 1 cup, broccoli 1 cup steamed' or paste nutrition label info..."}
                rows={3}
                style={{...BASE_INPUT,resize:"vertical",lineHeight:1.5,marginBottom:8}}
              />
              <button
                disabled={!photoDesc.trim()||photoLoading}
                onClick={async()=>{
                  setPhotoLoading(true);
                  try {
                    const res = await fetch("https://api.anthropic.com/v1/messages",{
                      method:"POST", headers:{"Content-Type":"application/json","anthropic-version":"2023-06-01","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY},
                      body:JSON.stringify({
                        model:"claude-opus-4-7", max_tokens:400,
                        system:`You are a nutrition data extractor. Given a meal description, return ONLY valid JSON with no markdown, no explanation — just the object:
{"name":"meal name","cal":number,"protein":number,"sodium":number,"fat":number,"carbs":number}
Estimate reasonable values if exact amounts unknown. sodium in mg, all others in grams except cal.`,
                        messages:[{role:"user",content:photoDesc}]
                      })
                    });
                    const data = await res.json();
                    const text = (data.content || []).map((b) => b.text || "").join("").trim();
                    const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
                    setNutForm({
                      name:    parsed.name    || photoDesc.slice(0,40),
                      cal:     String(parsed.cal     || ""),
                      protein: String(parsed.protein || ""),
                      sodium:  String(parsed.sodium  || ""),
                      fat:     String(parsed.fat     || ""),
                      carbs:   String(parsed.carbs   || ""),
                    });
                    setPhotoDesc("");
                    setShowNutForm(true);
                  } catch(e) {
                    alert("Parse failed — try again or enter manually");
                  }
                  setPhotoLoading(false);
                }}
                style={{background:photoLoading?"#1a2e1a":"#2d4a2d",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"6px 14px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}
              >{photoLoading?"PARSING...":"PARSE MEAL →"}</button>
            </div>

            {/* ── Manual entry form ── */}
            <div style={{marginBottom:12}}>
              <button onClick={()=>setShowNutForm(v=>!v)} style={{background:"#1a2e1a",border:"1px solid #2d4a2d",color:"#6aaa6a",padding:"6px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO,marginBottom:showNutForm?8:0}}>
                {showNutForm?"▲ CLOSE":"▼ MANUAL ENTRY"}
              </button>
              {showNutForm&&(
                <div style={{background:"#0d130d",border:"1px solid #1e321e",padding:12}}>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>
                    {[{k:"name",p:"MEAL NAME",w:"2fr"},{k:"cal",p:"CAL"},{k:"protein",p:"PROTEIN g"},{k:"sodium",p:"SODIUM mg"},{k:"fat",p:"FAT g"},{k:"carbs",p:"CARBS g"}].map(f=>(
                      <div key={f.k}>
                        <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:3}}>{f.p}</div>
                        <input type={f.k==="name"?"text":"number"} value={nutForm[f.k]}
                          onChange={e=>setNutForm(p=>({...p,[f.k]:e.target.value}))}
                          style={BASE_INPUT} />
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{
                      if(!nutForm.name&&!nutForm.cal) return;
                      setFoodLog(p=>[...p,{...nutForm,id:Date.now()}]);
                      setNutForm({name:"",cal:"",protein:"",sodium:"",fat:"",carbs:""});
                      setShowNutForm(false);
                    }} style={{background:"#1a2e1a",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"6px 14px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>+ LOG MEAL</button>
                    {nutForm.name&&<button onClick={()=>{
                      const newMeal = {...nutForm, id:`sm${Date.now()}`};
                      setSavedMeals(p=>[...p, {...newMeal, cal:Number(newMeal.cal), protein:Number(newMeal.protein), sodium:Number(newMeal.sodium), fat:Number(newMeal.fat), carbs:Number(newMeal.carbs)}]);
                      alert(`"${nutForm.name}" saved to your meal library`);
                    }} style={{background:"transparent",border:"1px solid #2d4a2d",color:"#4a6a4a",padding:"6px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>SAVE TO LIBRARY</button>}
                  </div>
                </div>
              )}
            </div>

            {/* ── Today's food log ── */}
            {foodLog.length===0?(
              <div style={{textAlign:"center",color:"#2d4a2d",fontSize:9,letterSpacing:3,padding:"30px 0"}}>NO MEALS LOGGED YET</div>
            ):(
              <div>
                <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:7}}>TODAY'S LOG</div>
                {foodLog.map((e,i)=>(
                  <div key={e.id} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 24px",gap:5,padding:"7px 8px",fontSize:10,color:"#c8d4c8",borderBottom:"1px solid #0f1f0f",background:i%2===0?"#0d130d":"#0a0f0a",alignItems:"center"}}>
                    <span style={{color:"#9aba9a",fontSize:11}}>{e.name}</span>
                    <span>{e.cal}<span style={{color:"#4a6a4a",fontSize:8}}>cal</span></span>
                    <span>{e.protein}<span style={{color:"#4a6a4a",fontSize:8}}>g</span></span>
                    <span>{e.sodium}<span style={{color:"#4a6a4a",fontSize:8}}>mg</span></span>
                    <span>{e.carbs}<span style={{color:"#4a6a4a",fontSize:8}}>g</span></span>
                    <button onClick={()=>setFoodLog(p=>p.filter(x=>x.id!==e.id))} style={{background:"transparent",border:"none",color:"#4a3030",cursor:"pointer",fontSize:11}}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ 04 COACH AI ════════════════════════════════════════════════════ */}
        {tab==="chat"&&(
          <div style={{display:"flex",flexDirection:"column",height:"70vh"}}>
            <div style={{fontSize:7,letterSpacing:3,color:"#4a6a4a",marginBottom:8}}>COACH AI // R:{oura.readiness} // {tier} // HRV:{oura.hrv}ms // BACK:{backPain}/10 // SH:{shoulderPain}/10 // BLOCK {currentBlock} // {nutTotals.cal}cal/{nutTotals.protein}g logged</div>
            <div style={{flex:1,overflowY:"auto",background:"#0d130d",border:"1px solid #1e321e",padding:12,marginBottom:8,display:"flex",flexDirection:"column",gap:9}}>
              {messages.map((m,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                  <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:2}}>{m.role==="user"?"OPERATOR":"COACH AI"}</div>
                  <div style={{background:m.role==="user"?"#1a2e1a":"#111a11",border:`1px solid ${m.role==="user"?"#2d4a2d":"#1e321e"}`,padding:"8px 11px",maxWidth:"82%",fontSize:12,color:m.role==="user"?"#9aba9a":"#c8d4c8",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{m.content}</div>
                </div>
              ))}
              {chatLoading&&(
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
                  <div style={{fontSize:7,letterSpacing:2,color:"#4a6a4a",marginBottom:2}}>COACH AI</div>
                  <div style={{background:"#111a11",border:"1px solid #1e321e",padding:"8px 11px",color:"#4a6a4a",fontSize:12}}>PROCESSING...</div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
            <div style={{display:"flex",gap:7}}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendMessage()} placeholder="Ask your coach..." style={{flex:1,...BASE_INPUT,fontSize:13,padding:"8px 11px"}} />
              <button onClick={sendMessage} disabled={chatLoading||!chatInput.trim()} style={{background:chatLoading?"#1a2e1a":"#2d4a2d",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"8px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>SEND →</button>
            </div>
          </div>
        )}

        {/* ══ 05 LOG ══════════════════════════════════════════════════════════ */}
        {tab==="log"&&(
          <div>
            <div style={{fontSize:7,letterSpacing:3,color:"#4a6a4a",marginBottom:10}}>SESSION LOG // {logDate} // {tier} // BLOCK {currentBlock}</div>
            <div style={{background:"#0d130d",border:"1px solid #1e321e",padding:12,marginBottom:14}}>
              <div style={{fontSize:7,letterSpacing:3,color:"#6aaa6a",marginBottom:9}}>MANUAL LOG ENTRY</div>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:6,marginBottom:6}}>
                {[{key:"exercise",p:"EXERCISE",t:"text"},{key:"sets",p:"SETS",t:"number"},{key:"reps",p:"REPS",t:"text"},{key:"weight",p:"LBS",t:"text"}].map(f=>(
                  <input key={f.key} type={f.t} placeholder={f.p} value={logForm[f.key]} onChange={e=>setLogForm(p=>({...p,[f.key]:e.target.value}))} style={BASE_INPUT} />
                ))}
              </div>
              <div style={{display:"flex",gap:6}}>
                <input placeholder="NOTES" value={logForm.notes} onChange={e=>setLogForm(p=>({...p,notes:e.target.value}))} style={{flex:1,...BASE_INPUT}} />
                <button onClick={()=>{if(!logForm.exercise)return;setLogEntries(p=>[...p,{...logForm,id:Date.now()}]);setLogForm({exercise:"",sets:"",reps:"",weight:"",notes:""}); }} style={{background:"#1a2e1a",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"5px 12px",cursor:"pointer",fontSize:8,letterSpacing:2,...MONO}}>+ ADD</button>
              </div>
            </div>
            {logEntries.length===0
              ?<div style={{textAlign:"center",color:"#2d4a2d",fontSize:9,letterSpacing:3,padding:"36px 0"}}>NO ENTRIES LOGGED</div>
              :(
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 2fr 28px",gap:5,padding:"3px 7px",fontSize:7,letterSpacing:3,color:"#3a5a3a",borderBottom:"1px solid #1e321e",marginBottom:3}}>
                    <span>EXERCISE</span><span>SETS</span><span>REPS</span><span>LBS</span><span>NOTES</span><span></span>
                  </div>
                  {logEntries.map(e=>(
                    <div key={e.id} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 2fr 28px",gap:5,padding:"6px 7px",fontSize:10,color:"#c8d4c8",borderBottom:"1px solid #0f1f0f",background:"#0d130d",alignItems:"center"}}>
                      <span style={{color:"#9aba9a"}}>{e.exercise}</span>
                      <span>{e.sets}</span><span>{e.reps}</span><span>{e.weight}</span>
                      <span style={{color:"#6a8a6a",fontSize:9}}>{e.notes}</span>
                      <button onClick={()=>setLogEntries(p=>p.filter(x=>x.id!==e.id))} style={{background:"transparent",border:"none",color:"#4a3030",cursor:"pointer",fontSize:11}}>✕</button>
                    </div>
                  ))}
                  <div style={{marginTop:10,background:"#0d130d",border:"1px solid #1e321e",padding:"8px 12px",display:"flex",gap:22,fontSize:10}}>
                    <div><span style={{color:"#4a6a4a"}}>EXERCISES: </span>{logEntries.length}</div>
                    <div><span style={{color:"#4a6a4a"}}>TOTAL SETS: </span>{logEntries.reduce((a,e)=>a+(Number(e.sets)||0),0)}</div>
                  </div>
                </div>
              )}
          </div>
        )}

      </main>

      <footer style={{borderTop:"1px solid #1a2a1a",padding:"5px 16px",display:"flex",justifyContent:"space-between",fontSize:7,color:"#2d4a2d",letterSpacing:2}}>
        <span>SQUAREBUSH SERVICES LLC // STRENGTH OPS</span>
        <span>SARCOPENIA IS THE ENEMY</span>
      </footer>
    </div>
  );
}
