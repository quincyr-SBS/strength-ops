import { useState, useRef, useEffect } from "react";
import { useOuraSync } from "./hooks/useOuraSync";
// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a strength and longevity coach for a 47-year-old male (DL 350, SQ 300, DB bench 115, back injury recovery, Oura Ring user). Draw from Dr. Vonda Wright, Peter Attia, Stuart McGill, Andy Galpin, Pavel Tsatsouline, Matthew Walker, and Gabrielle Lyon.
Core rules:
- Protein: 1g/lb bodyweight minimum, 40-50g at first meal, creatine 3-5g daily always
- Training: protect the spine, Zone 2 at ~133 bpm, progressive overload without ego
- Sleep: Oura readiness 85+ = train hard, 70-84 = moderate, below 70 = recovery only
- HRV dropping 3+ days = cut volume. Elevated resting HR 5+ bpm = elevated baseline = Zone 2 or rest
- No prolonged fasting on training days
- Sarcopenia is the enemy — muscle mass is non-negotiable after 45
Always give specific numbers. No vague advice. No fluff. Be direct and tactical. Keep responses concise but precise.`;

// ─────────────────────────────────────────────────────────────────────────────
// TIER CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const TIER_CONFIG = {
  HARD:     { label:"TRAIN HARD",    range:"READINESS ≥ 85", color:"#4ade80", bg:"rgba(74,222,128,0.08)",  border:"#4ade80",  desc:"Full intensity. Progressive overload. Hit PRs." },
  MODERATE: { label:"MODERATE",      range:"READINESS 70–84", color:"#facc15", bg:"rgba(250,204,21,0.08)",  border:"#facc15",  desc:"Sub-maximal effort. Stay within RPE targets. No new PRs." },
  RECOVERY: { label:"RECOVERY ONLY", range:"READINESS < 70",  color:"#f87171", bg:"rgba(248,113,113,0.08)", border:"#f87171",  desc:"Zone 2 walk, mobility, McGill Big 3. No loading." },
};

// ─────────────────────────────────────────────────────────────────────────────
// PERIODIZED PROGRAM — 8-week block
// Structure per exercise: { id, name, cue, weeks: { [wk]: { sets, reps, load, rpe, note } } }
// load = string (human-readable), loadNum = number for scaling
// ─────────────────────────────────────────────────────────────────────────────

// Helper: build week entries across 4-week base block + deload + intensification
function wb(w1, w2, w3, w4, w5deload, w6, w7, w8) {
  return { 1: w1, 2: w2, 3: w3, 4: w4, 5: w5deload, 6: w6, 7: w7, 8: w8 };
}

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
        id: "goblet_sq", name: "GOBLET BOX SQUAT", cue: "Sit to box, hip crease at or below knee, brace before descending",
        weeks: wb(
          { sets:3, reps:8, load:"70 lb DB", loadNum:70,  rpe:"RPE 6–7 — adjust ±10 lb" },
          { sets:3, reps:8, load:"75 lb DB", loadNum:75,  rpe:"RPE 6–7" },
          { sets:3, reps:8, load:"80 lb DB", loadNum:80,  rpe:"RPE 7" },
          { sets:3, reps:8, load:"80 lb DB", loadNum:80,  rpe:"RPE 7 or +1 rep/set if clean" },
          { sets:2, reps:8, load:"70 lb DB", loadNum:70,  rpe:"RPE 6 — deload" },
          { sets:3, reps:8, load:"80 lb DB", loadNum:80,  rpe:"RPE 7" },
          { sets:3, reps:8, load:"85 lb DB", loadNum:85,  rpe:"RPE 7" },
          { sets:4, reps:8, load:"85 lb DB", loadNum:85,  rpe:"RPE 7–8" },
        ),
      },
      {
        id: "db_bench_mon", name: "DB BENCH PRESS", cue: "Retract scapula, controlled descent, 90s rest between sets",
        weeks: wb(
          { sets:4, reps:8,  load:"90 lb DB",  loadNum:90,  rpe:"RPE 7" },
          { sets:4, reps:8,  load:"95 lb DB",  loadNum:95,  rpe:"RPE 7" },
          { sets:4, reps:8,  load:"100 lb DB", loadNum:100, rpe:"RPE 7" },
          { sets:4, reps:8,  load:"100 lb DB", loadNum:100, rpe:"RPE 7 — add rep if ≤7" },
          { sets:2, reps:8,  load:"90 lb DB",  loadNum:90,  rpe:"RPE 6 — deload" },
          { sets:5, reps:6,  load:"100 lb DB", loadNum:100, rpe:"RPE 7" },
          { sets:5, reps:6,  load:"105 lb DB", loadNum:105, rpe:"RPE 7–8" },
          { sets:5, reps:5,  load:"110 lb DB", loadNum:110, rpe:"RPE 8 — HARD tier only" },
        ),
      },
      {
        id: "cable_row_mon", name: "CABLE SEATED ROW", cue: "Drive elbows back, full contraction, no momentum",
        weeks: wb(
          { sets:3, reps:10, load:"160 lb", loadNum:160, rpe:"controlled" },
          { sets:3, reps:10, load:"165 lb", loadNum:165, rpe:"controlled" },
          { sets:3, reps:10, load:"170 lb", loadNum:170, rpe:"controlled" },
          { sets:3, reps:10, load:"175 lb", loadNum:175, rpe:"controlled" },
          { sets:2, reps:10, load:"155 lb", loadNum:155, rpe:"deload" },
          { sets:4, reps:10, load:"175 lb", loadNum:175, rpe:"controlled" },
          { sets:4, reps:10, load:"180 lb", loadNum:180, rpe:"controlled" },
          { sets:4, reps:10, load:"185 lb", loadNum:185, rpe:"controlled" },
        ),
      },
      {
        id: "pallof_mon", name: "PALLOF PRESS", cue: "No rotation — this is anti-rotation. Brace hard, press to full extension, hold 2s",
        weeks: wb(
          { sets:3, reps:10, load:"20–30 lb / side", loadNum:25,  rpe:"strict" },
          { sets:3, reps:10, load:"25–30 lb / side", loadNum:27,  rpe:"strict" },
          { sets:3, reps:10, load:"30 lb / side",    loadNum:30,  rpe:"strict" },
          { sets:3, reps:10, load:"30–35 lb / side", loadNum:32,  rpe:"strict" },
          { sets:2, reps:10, load:"20–25 lb / side", loadNum:22,  rpe:"deload" },
          { sets:3, reps:12, load:"30–35 lb / side", loadNum:32,  rpe:"strict" },
          { sets:3, reps:12, load:"35 lb / side",    loadNum:35,  rpe:"strict" },
          { sets:4, reps:12, load:"35–40 lb / side", loadNum:37,  rpe:"strict" },
        ),
      },
    ],
  },
  TUE: {
    label: "TUESDAY", focus: "LIFT + ZONE 2", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 POST-LIFT", duration: "60 min", target: "~133 bpm", note: "After lifting." }],
    warmup: ["Hip hinge drill — 2×10", "Glute bridge — 2×15", "Dead bug — 2×10/side"],
    exercises: [
      {
        id: "trap_bar", name: "TRAP BAR DEADLIFT (HIGH HANDLES)", cue: "Hinge — not squat. Brace before pull. No lumbar rounding. High handles protect spine.",
        gates: { week8: "Only at 350+ if Readiness ≥85 and back pain ≤2/10. Otherwise repeat Week 6 loads." },
        weeks: wb(
          { sets:4, reps:5, load:"305 lb", loadNum:305, rpe:"RPE 7" },
          { sets:4, reps:5, load:"315 lb", loadNum:315, rpe:"RPE 7–8" },
          { sets:5, reps:4, load:"325 lb", loadNum:325, rpe:"RPE 8" },
          { sets:5, reps:4, load:"335 lb", loadNum:335, rpe:"RPE 8" },
          { sets:2, reps:5, load:"295 lb", loadNum:295, rpe:"RPE 6 — deload" },
          { sets:5, reps:3, load:"350 lb", loadNum:350, rpe:"HARD tier only — RPE 8" },
          { sets:6, reps:2, load:"365 lb", loadNum:365, rpe:"HARD tier only — RPE 8–9" },
          { sets:5, reps:2, load:"375 lb", loadNum:375, rpe:"HARD tier only + back ≤2/10" },
        ),
      },
      {
        id: "lat_pull", name: "LAT PULLDOWN", cue: "Lean back slightly, pull to upper chest, full stretch overhead, controlled",
        weeks: wb(
          { sets:4, reps:10, load:"180 lb", loadNum:180, rpe:"controlled" },
          { sets:4, reps:10, load:"185 lb", loadNum:185, rpe:"controlled" },
          { sets:4, reps:10, load:"190 lb", loadNum:190, rpe:"controlled" },
          { sets:4, reps:10, load:"195 lb", loadNum:195, rpe:"controlled" },
          { sets:2, reps:10, load:"170 lb", loadNum:170, rpe:"deload" },
          { sets:4, reps:8,  load:"195 lb", loadNum:195, rpe:"controlled" },
          { sets:4, reps:8,  load:"200 lb", loadNum:200, rpe:"controlled" },
          { sets:5, reps:8,  load:"200 lb", loadNum:200, rpe:"controlled" },
        ),
      },
      {
        id: "hip_thrust", name: "BARBELL HIP THRUST", cue: "Chin tucked, glute squeeze at top, no lumbar overextension",
        weeks: wb(
          { sets:3, reps:10, load:"180 lb", loadNum:180, rpe:"RPE 6–7" },
          { sets:3, reps:10, load:"200 lb", loadNum:200, rpe:"RPE 7" },
          { sets:3, reps:10, load:"220 lb", loadNum:220, rpe:"RPE 7" },
          { sets:3, reps:10, load:"240 lb", loadNum:240, rpe:"RPE 7–8" },
          { sets:2, reps:10, load:"180 lb", loadNum:180, rpe:"RPE 6 — deload" },
          { sets:3, reps:10, load:"250 lb", loadNum:250, rpe:"RPE 7–8" },
          { sets:4, reps:10, load:"260 lb", loadNum:260, rpe:"RPE 8" },
          { sets:4, reps:10, load:"270 lb", loadNum:270, rpe:"RPE 8" },
        ),
      },
      {
        id: "face_pull", name: "CABLE FACE PULL", cue: "Pull to forehead, external rotate at end. Rear delt + rotator cuff health.",
        weeks: wb(
          { sets:2, reps:15, load:"40–60 lb", loadNum:50,  rpe:"controlled" },
          { sets:2, reps:15, load:"45–60 lb", loadNum:52,  rpe:"controlled" },
          { sets:3, reps:15, load:"50–60 lb", loadNum:55,  rpe:"controlled" },
          { sets:3, reps:15, load:"55–65 lb", loadNum:60,  rpe:"controlled" },
          { sets:2, reps:15, load:"40–50 lb", loadNum:45,  rpe:"deload" },
          { sets:3, reps:15, load:"55–65 lb", loadNum:60,  rpe:"controlled" },
          { sets:3, reps:15, load:"60–70 lb", loadNum:65,  rpe:"controlled" },
          { sets:3, reps:15, load:"65–70 lb", loadNum:67,  rpe:"controlled" },
        ),
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
    warmup: ["Band pull-apart — 3×15", "Wall slides — 2×12", "Cuban press 5lb — 2×10"],
    exercises: [
      {
        id: "incline_db", name: "INCLINE DB BENCH PRESS", cue: "30–45° incline. Retract scapula. Controlled descent. No bounce.",
        weeks: wb(
          { sets:4, reps:6, load:"80 lb DB",  loadNum:80,  rpe:"RPE 7" },
          { sets:4, reps:6, load:"85 lb DB",  loadNum:85,  rpe:"RPE 7" },
          { sets:4, reps:6, load:"90 lb DB",  loadNum:90,  rpe:"RPE 7–8" },
          { sets:4, reps:6, load:"90 lb DB",  loadNum:90,  rpe:"RPE 7–8 — add reps if RPE allows" },
          { sets:2, reps:6, load:"75 lb DB",  loadNum:75,  rpe:"RPE 6 — deload" },
          { sets:4, reps:6, load:"90 lb DB",  loadNum:90,  rpe:"RPE 7" },
          { sets:4, reps:6, load:"95 lb DB",  loadNum:95,  rpe:"RPE 7–8" },
          { sets:4, reps:5, load:"100 lb DB", loadNum:100, rpe:"RPE 8 — if Readiness allows" },
        ),
      },
      {
        id: "cable_row_thu", name: "CABLE ROW (CHEST-SUPPORTED)", cue: "No momentum. Row to lower chest. Full stretch at extension.",
        weeks: wb(
          { sets:4, reps:8, load:"160 lb", loadNum:160, rpe:"controlled" },
          { sets:4, reps:8, load:"165 lb", loadNum:165, rpe:"controlled" },
          { sets:4, reps:8, load:"170 lb", loadNum:170, rpe:"controlled" },
          { sets:4, reps:8, load:"175 lb", loadNum:175, rpe:"controlled" },
          { sets:2, reps:8, load:"155 lb", loadNum:155, rpe:"deload" },
          { sets:4, reps:8, load:"175 lb", loadNum:175, rpe:"controlled" },
          { sets:4, reps:8, load:"180 lb", loadNum:180, rpe:"controlled" },
          { sets:5, reps:8, load:"185 lb", loadNum:185, rpe:"controlled" },
        ),
      },
      {
        id: "seated_db_press", name: "SEATED DB SHOULDER PRESS", cue: "Neutral spine, no lumbar arch — brace before every rep. Press straight overhead.",
        weeks: wb(
          { sets:3, reps:8, load:"45 lb DB", loadNum:45, rpe:"RPE 6–7 — adjust ±5–10 lb" },
          { sets:3, reps:8, load:"50 lb DB", loadNum:50, rpe:"RPE 7" },
          { sets:3, reps:8, load:"55 lb DB", loadNum:55, rpe:"RPE 7" },
          { sets:3, reps:8, load:"55 lb DB", loadNum:55, rpe:"RPE 7 — add rep if RPE drops" },
          { sets:2, reps:8, load:"40 lb DB", loadNum:40, rpe:"RPE 6 — deload" },
          { sets:4, reps:8, load:"55 lb DB", loadNum:55, rpe:"RPE 7" },
          { sets:4, reps:8, load:"60 lb DB", loadNum:60, rpe:"RPE 7–8" },
          { sets:4, reps:6, load:"65 lb DB", loadNum:65, rpe:"RPE 8" },
        ),
      },
      {
        id: "tri_pressdown", name: "TRICEPS CABLE PRESSDOWN", cue: "Lock elbows at sides, full extension, controlled return",
        weeks: wb(
          { sets:2, reps:12, load:"50–70 lb", loadNum:60, rpe:"controlled" },
          { sets:2, reps:12, load:"55–70 lb", loadNum:62, rpe:"controlled" },
          { sets:3, reps:12, load:"60–70 lb", loadNum:65, rpe:"controlled" },
          { sets:3, reps:12, load:"65–75 lb", loadNum:70, rpe:"controlled" },
          { sets:2, reps:12, load:"50–60 lb", loadNum:55, rpe:"deload" },
          { sets:3, reps:12, load:"65–75 lb", loadNum:70, rpe:"controlled" },
          { sets:3, reps:12, load:"70–80 lb", loadNum:75, rpe:"controlled" },
          { sets:3, reps:10, load:"75–85 lb", loadNum:80, rpe:"controlled" },
        ),
      },
    ],
  },
  FRI: {
    label: "FRIDAY", focus: "LIFT (AM) + ZONE 2 (PM)", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 PM SESSION", duration: "45–60 min", target: "~133 bpm", note: "Separate from lifting. Easy pace." }],
    warmup: ["Lateral band walk — 2×15", "Goblet squat hold 30s", "Hip flexor stretch 60s/side"],
    exercises: [
      {
        id: "split_sq", name: "BULGARIAN SPLIT SQUAT (DB)", cue: "Front foot far enough — torso upright, knee tracks toe. NO spinal loading.",
        weeks: wb(
          { sets:3, reps:8, load:"20 lb DB / side", loadNum:20, rpe:"RPE 6–7" },
          { sets:3, reps:8, load:"25 lb DB / side", loadNum:25, rpe:"RPE 7" },
          { sets:3, reps:8, load:"30 lb DB / side", loadNum:30, rpe:"RPE 7" },
          { sets:3, reps:8, load:"30 lb DB / side", loadNum:30, rpe:"RPE 7 — add reps if ≤7" },
          { sets:2, reps:8, load:"20 lb DB / side", loadNum:20, rpe:"RPE 6 — deload" },
          { sets:4, reps:8, load:"30 lb DB / side", loadNum:30, rpe:"RPE 7" },
          { sets:4, reps:8, load:"35 lb DB / side", loadNum:35, rpe:"RPE 7–8" },
          { sets:4, reps:8, load:"40 lb DB / side", loadNum:40, rpe:"RPE 8" },
        ),
      },
      {
        id: "cable_ham", name: "CABLE HAMSTRING CURL (SINGLE LEG)", cue: "Full ROM, slow eccentric (3s), don't let hip flexors dominate",
        weeks: wb(
          { sets:3, reps:12, load:"25–35 lb / side", loadNum:30, rpe:"controlled" },
          { sets:3, reps:12, load:"30–35 lb / side", loadNum:32, rpe:"controlled" },
          { sets:3, reps:12, load:"35–40 lb / side", loadNum:37, rpe:"controlled" },
          { sets:3, reps:12, load:"35–40 lb / side", loadNum:37, rpe:"controlled" },
          { sets:2, reps:12, load:"25–30 lb / side", loadNum:27, rpe:"deload" },
          { sets:3, reps:12, load:"40 lb / side",    loadNum:40, rpe:"controlled" },
          { sets:4, reps:12, load:"42–45 lb / side", loadNum:43, rpe:"controlled" },
          { sets:4, reps:12, load:"45–50 lb / side", loadNum:47, rpe:"controlled" },
        ),
      },
      {
        id: "glute_bridge", name: "BARBELL GLUTE BRIDGE", cue: "Chin tucked, brace hard, drive hips up — not a back extension",
        weeks: wb(
          { sets:2, reps:12, load:"135–185 lb", loadNum:160, rpe:"RPE 6–7" },
          { sets:2, reps:12, load:"165–185 lb", loadNum:175, rpe:"RPE 7" },
          { sets:3, reps:12, load:"185 lb",     loadNum:185, rpe:"RPE 7" },
          { sets:3, reps:12, load:"195 lb",     loadNum:195, rpe:"RPE 7–8" },
          { sets:2, reps:10, load:"135–155 lb", loadNum:145, rpe:"RPE 6 — deload" },
          { sets:3, reps:12, load:"200 lb",     loadNum:200, rpe:"RPE 7–8" },
          { sets:3, reps:12, load:"215 lb",     loadNum:215, rpe:"RPE 8" },
          { sets:4, reps:10, load:"225 lb",     loadNum:225, rpe:"RPE 8" },
        ),
      },
      {
        id: "farmer", name: "FARMER CARRY", cue: "Tall posture, packed shoulders, crisp steps — core endurance under load",
        weeks: wb(
          { sets:5, reps:1, load:"70–90 lb / hand × 30–40m", loadNum:80, rpe:"controlled — RPE 6" },
          { sets:5, reps:1, load:"80–90 lb / hand × 35m",    loadNum:85, rpe:"controlled" },
          { sets:5, reps:1, load:"85–95 lb / hand × 35–40m", loadNum:90, rpe:"controlled" },
          { sets:5, reps:1, load:"90–100 lb / hand × 40m",   loadNum:95, rpe:"controlled" },
          { sets:3, reps:1, load:"70–80 lb / hand × 30m",    loadNum:75, rpe:"deload — easy" },
          { sets:5, reps:1, load:"95–105 lb / hand × 40m",   loadNum:100,rpe:"controlled" },
          { sets:5, reps:1, load:"100–110 lb / hand × 40m",  loadNum:105,rpe:"controlled" },
          { sets:6, reps:1, load:"105–115 lb / hand × 40m",  loadNum:110,rpe:"controlled" },
        ),
      },
    ],
  },
  SAT: {
    label: "SATURDAY", focus: "LIGHT LIFT + LIGHT CARDIO", type: "lift+cardio",
    cardio: [{ name: "ZONE 2 EASY", duration: "30–45 min", target: "120–133 bpm", note: "Light. This is active recovery." }],
    warmup: ["McGill Big 3 — 1 round", "Band pull-apart — 2×12"],
    note: "SAT = technique practice + movement quality. RPE cap: 6. No grinding.",
    exercises: [
      {
        id: "trap_sat", name: "TRAP BAR TECHNIQUE (HIGH HANDLES)", cue: "Technique focus — RPE 5–6 hard cap. Pattern reinforcement only.",
        weeks: wb(
          { sets:3, reps:5, load:"225–245 lb", loadNum:235, rpe:"RPE 5–6 — cap" },
          { sets:3, reps:5, load:"235–250 lb", loadNum:242, rpe:"RPE 5–6 — cap" },
          { sets:3, reps:5, load:"240–255 lb", loadNum:247, rpe:"RPE 5–6 — cap" },
          { sets:3, reps:5, load:"245–260 lb", loadNum:252, rpe:"RPE 5–6 — cap" },
          { sets:2, reps:5, load:"205–225 lb", loadNum:215, rpe:"RPE 5 — deload" },
          { sets:3, reps:5, load:"250–265 lb", loadNum:257, rpe:"RPE 5–6 — cap" },
          { sets:3, reps:5, load:"255–270 lb", loadNum:262, rpe:"RPE 5–6 — cap" },
          { sets:3, reps:5, load:"260–275 lb", loadNum:267, rpe:"RPE 5–6 — cap" },
        ),
      },
      {
        id: "db_bench_sat", name: "DB BENCH OR PUSH-UPS", cue: "Low intensity only. Technique drill. No grinding.",
        weeks: wb(
          { sets:2, reps:12, load:"60 lb DB or bodyweight", loadNum:60, rpe:"RPE 5–6" },
          { sets:2, reps:12, load:"60–65 lb DB",            loadNum:62, rpe:"RPE 5–6" },
          { sets:2, reps:12, load:"65 lb DB",               loadNum:65, rpe:"RPE 5–6" },
          { sets:2, reps:12, load:"65 lb DB",               loadNum:65, rpe:"RPE 5–6" },
          { sets:2, reps:12, load:"55 lb DB or push-ups",   loadNum:55, rpe:"RPE 5 — deload" },
          { sets:2, reps:12, load:"65–70 lb DB",            loadNum:67, rpe:"RPE 5–6" },
          { sets:2, reps:12, load:"70 lb DB",               loadNum:70, rpe:"RPE 6" },
          { sets:2, reps:12, load:"70–75 lb DB",            loadNum:72, rpe:"RPE 6" },
        ),
      },
      {
        id: "cable_row_sat", name: "CABLE ROW", cue: "Smooth, no momentum. Move weight, don't jerk it.",
        weeks: wb(
          { sets:2, reps:12, load:"140–150 lb", loadNum:145, rpe:"controlled" },
          { sets:2, reps:12, load:"145–155 lb", loadNum:150, rpe:"controlled" },
          { sets:2, reps:12, load:"150–160 lb", loadNum:155, rpe:"controlled" },
          { sets:2, reps:12, load:"155–165 lb", loadNum:160, rpe:"controlled" },
          { sets:2, reps:12, load:"135–145 lb", loadNum:140, rpe:"deload" },
          { sets:2, reps:12, load:"155–165 lb", loadNum:160, rpe:"controlled" },
          { sets:2, reps:12, load:"160–170 lb", loadNum:165, rpe:"controlled" },
          { sets:2, reps:12, load:"165–175 lb", loadNum:170, rpe:"controlled" },
        ),
      },
      {
        id: "pallof_sat", name: "PALLOF PRESS", cue: "Anti-rotation. Brace, extend, hold 2s. Spine health.",
        weeks: wb(
          { sets:2, reps:10, load:"20–30 lb", loadNum:25, rpe:"strict" },
          { sets:2, reps:10, load:"25–30 lb", loadNum:27, rpe:"strict" },
          { sets:2, reps:10, load:"28–32 lb", loadNum:30, rpe:"strict" },
          { sets:2, reps:10, load:"30–35 lb", loadNum:32, rpe:"strict" },
          { sets:2, reps:10, load:"20–25 lb", loadNum:22, rpe:"deload" },
          { sets:2, reps:10, load:"30–35 lb", loadNum:32, rpe:"strict" },
          { sets:2, reps:10, load:"33–38 lb", loadNum:35, rpe:"strict" },
          { sets:2, reps:10, load:"35–40 lb", loadNum:37, rpe:"strict" },
        ),
      },
    ],
  },
};

const DAY_ORDER = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const WEEK_LABELS = {
  1:"BASE WK 1", 2:"BASE WK 2", 3:"BASE WK 3", 4:"BASE WK 4",
  5:"DELOAD WK 5", 6:"INTENSIFY WK 6", 7:"INTENSIFY WK 7", 8:"INTENSIFY WK 8"
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getTier(r){ return r>=85?"HARD":r>=70?"MODERATE":"RECOVERY"; }
function getHRVAlert(avg,today){ if(!avg||!today)return null; const d=avg-today; return d>=3?`HRV DOWN ${d}MS VS 7-DAY — CUT VOLUME`:null; }
function getRHRAlert(base,today){ if(!base||!today)return null; const r=today-base; return r>=5?`RHR +${r} BPM ABOVE BASELINE — ZONE 2 OR REST`:null; }
function todayKey(){ return DAY_ORDER[new Date().getDay()]; }

// Scale load string for MODERATE tier (80%) — only numeric standalone loads
function scaleLoad(load, mult) {
  if (mult === 1.0) return load;
  // Try to scale the first number in the string
  return load.replace(/(\d+)/g, (m) => Math.round(parseInt(m)*mult/5)*5);
}

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
function ExerciseCard({ ex, week, mult, readiness, data, onUpdate }) {
  const [open, setOpen] = useState(true);
  const wk = ex.weeks[week] || ex.weeks[1];
  const rows = Array.from({ length: wk.sets }, (_, i) => i);
  const doneCount = rows.filter(i => data[i]?.done).length;
  const allDone = doneCount === wk.sets;

  // Gate check (weeks 6–8 trap bar intensity)
  const gateMsg = ex.gates && week >= 6 ? ex.gates.week8 : null;
  const gated = gateMsg && readiness < 85;

  return (
    <div style={{
      border:`1px solid ${allDone?"#2d4a2d":gated?"#4a2a2a":"#1e321e"}`,
      background: allDone?"rgba(74,222,128,0.02)": gated?"rgba(248,113,113,0.03)":"#0d130d",
      marginBottom:10,
    }}>
      <div onClick={()=>setOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",cursor:"pointer",borderBottom:open?"1px solid #1a2a1a":"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:12,fontWeight:"bold",letterSpacing:2,color:allDone?"#4ade80":gated?"#f87171":"#c8d4c8",...MONO}}>
            {allDone?"✓ ":gated?"⚠ ":""}{ex.name}
          </span>
          <span style={{fontSize:8,color:"#4a6a4a",letterSpacing:1,...MONO}}>{doneCount}/{wk.sets} SETS</span>
          <span style={{fontSize:9,color:"#4a6a4a",background:"#111a11",padding:"1px 6px",border:"1px solid #1e321e",...MONO}}>
            {wk.sets}×{wk.reps} @ {mult<1?scaleLoad(wk.load,mult):wk.load}
          </span>
        </div>
        <span style={{color:"#4a6a4a",fontSize:10,...MONO}}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div>
          {ex.cue && <div style={{padding:"5px 12px",fontSize:9,color:"#5a7a5a",letterSpacing:1,borderBottom:"1px solid #0f1f0f",...MONO}}>› {ex.cue}</div>}
          {gated && <div style={{padding:"5px 12px",fontSize:9,color:"#f87171",background:"rgba(248,113,113,0.05)",borderBottom:"1px solid #3a1a1a",...MONO}}>⚠ {gateMsg}</div>}
          {mult < 1.0 && <div style={{padding:"4px 12px",fontSize:8,color:"#facc15",borderBottom:"1px solid #0f1f0f",...MONO}}>MODERATE TIER — LOADS SCALED TO 80%</div>}
          <div style={{display:"grid",gridTemplateColumns:"26px 50px 1fr 85px 1fr 90px",gap:5,padding:"4px 8px 2px",fontSize:7,letterSpacing:2,color:"#2a4a2a",borderBottom:"1px solid #0f1f0f",...MONO}}>
            <span>SET</span><span>REPS</span><span>PRESCRIBED</span><span>ACTUAL LB</span><span>REPS/NOTE</span><span></span>
          </div>
          {rows.map(i=>(
            <SetRow key={i} setNum={i+1} reps={wk.reps} load={wk.load} rpe={wk.rpe} mult={mult}
              actual={data[i]} onChange={v=>onUpdate(i,v)} />
          ))}
        </div>
      )}
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
  const [oura, setOura]       = useState(initOura);
  const [ouraInput, setOuraInput] = useState({...initOura});
  const [showOuraForm, setShowOuraForm] = useState(false);
  const [selDay, setSelDay]   = useState(todayKey());
  const [week, setWeek]       = useState(1);
  const [sessionData, setSessionData] = useState({});
  const [backPain, setBackPain] = useState(0);

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

  const tier   = getTier(oura.readiness);
  const tcfg   = TIER_CONFIG[tier];
  const mult   = tier==="HARD" ? 1.0 : tier==="MODERATE" ? 0.8 : 0;
  const hrvAlert = getHRVAlert(oura.hrv7day, oura.hrv);
  const rhrAlert = getRHRAlert(oura.rhrBaseline, oura.rhr);
  const isDeload = week === 5;
  const isIntensify = week >= 6;

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

  function getDayProgress(dk){
    const d = PROGRAM[dk];
    if(!d || !d.exercises || d.exercises.length===0) return null;
    const total = d.exercises.reduce((a,e)=>{
      const wk = e.weeks[week]||e.weeks[1];
      return a + wk.sets;
    }, 0);
    const done = d.exercises.reduce((a,e)=>{
      const wk = e.weeks[week]||e.weeks[1];
      const ed = (sessionData[dk]||{})[e.id]||{};
      return a + Array.from({length:wk.sets},(_,i)=>i).filter(i=>ed[i]?.done).length;
    }, 0);
    return {done, total};
  }

  async function sendMessage(){
    if(!chatInput.trim()||chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    const nutCtx = `[NUTRITION TODAY: ${nutTotals.cal}cal / ${nutTotals.protein}g protein / ${nutTotals.sodium}mg sodium / ${waterOz}oz water — targets: ${NUTRITION_TARGETS.cal}cal / ${NUTRITION_TARGETS.protein}g protein / ${NUTRITION_TARGETS.sodium}mg sodium / ${NUTRITION_TARGETS.water}oz — meals: ${foodLog.length>0?foodLog.map(f=>f.name).join(", "):"none logged"}]`;
    const ctx = `[OURA: Readiness ${oura.readiness}, HRV ${oura.hrv}ms (7d avg: ${oura.hrv7day}ms), RHR ${oura.rhr}bpm (baseline: ${oura.rhrBaseline}bpm), Tier: ${tier}, Week: ${week}, Back Pain: ${backPain}/10]\n${nutCtx}\n\n${userMsg}`;
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
          {/* Week selector */}
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:7,color:"#4a6a4a",letterSpacing:2,marginBottom:3}}>PROGRAM WEEK</div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <button onClick={()=>setWeek(w=>Math.max(1,w-1))} style={{background:"#1a2e1a",border:"1px solid #2d4a2d",color:"#6aaa6a",width:22,height:22,cursor:"pointer",fontSize:12,...MONO}}>‹</button>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:16,fontWeight:"bold",color: isDeload?"#f87171":isIntensify?"#facc15":"#6aaa6a",minWidth:28}}>{week}</div>
                <div style={{fontSize:7,color:"#3a5a3a",letterSpacing:1}}>{WEEK_LABELS[week]}</div>
              </div>
              <button onClick={()=>setWeek(w=>Math.min(8,w+1))} style={{background:"#1a2e1a",border:"1px solid #2d4a2d",color:"#6aaa6a",width:22,height:22,cursor:"pointer",fontSize:12,...MONO}}>›</button>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:7,color:"#6aaa6a",letterSpacing:2}}>STATUS</div>
            <div style={{color:tcfg.color,fontSize:11,fontWeight:"bold",letterSpacing:2}}>{tcfg.label}</div>
            <div style={{color:"#4a6a4a",fontSize:7,letterSpacing:1,marginTop:1}}>R:{oura.readiness} HRV:{oura.hrv} RHR:{oura.rhr}</div>
          </div>
        </div>
      </header>

      {/* ALERTS */}
      {(hrvAlert||rhrAlert) && (
        <div style={{background:"#0a0a0a",borderBottom:"1px solid #3a1a1a"}}>
          {[hrvAlert,rhrAlert].filter(Boolean).map((a,i)=>(
            <div key={i} style={{padding:"4px 18px",fontSize:9,color:"#f87171",letterSpacing:1,display:"flex",gap:8}}>⚠ {a}</div>
          ))}
        </div>
      )}
      {isDeload && <div style={{background:"rgba(248,113,113,0.06)",borderBottom:"1px solid #3a1a1a",padding:"4px 18px",fontSize:9,color:"#f87171",letterSpacing:2}}>WEEK 5 — MANDATORY DELOAD. 50–60% of sets. RPE cap 6. No grinding.</div>}
      {isIntensify && !isDeload && <div style={{background:"rgba(250,204,21,0.04)",borderBottom:"1px solid #3a3a0a",padding:"4px 18px",fontSize:9,color:"#facc15",letterSpacing:2}}>INTENSIFICATION BLOCK (WK {week}). Readiness gates active on heavy trap bar sets.</div>}

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
                </div>
                <button onClick={applyOura} style={{background:"#1a2e1a",border:"1px solid #6aaa6a",color:"#6aaa6a",padding:"5px 14px",cursor:"pointer",fontSize:8,letterSpacing:3,...MONO}}>APPLY →</button>
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
                   tier==="MODERATE"?"80% LOADS — RPE TARGETS STILL APPLY":
                   "FULL PROGRAM — HIT YOUR NUMBERS"}
                </span>
              </div>
              <span style={{fontSize:9,color: isDeload?"#f87171":isIntensify?"#facc15":"#6aaa6a",letterSpacing:2,fontWeight:"bold"}}>{WEEK_LABELS[week]}</span>
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
                {tier==="RECOVERY"&&<div style={{fontSize:8,color:"#f87171",letterSpacing:1,marginBottom:8,padding:"5px 9px",background:"rgba(248,113,113,0.05)",border:"1px solid rgba(248,113,113,0.15)"}}>✕ RECOVERY DAY — NO LOADING. ZONE 2 CARDIO AND MCGILL BIG 3 ONLY.</div>}

                {/* Exercises */}
                {tier!=="RECOVERY"&&day.exercises.map(ex=>(
                  <ExerciseCard key={ex.id} ex={ex} week={week} mult={mult} readiness={oura.readiness}
                    data={(sessionData[selDay]||{})[ex.id]||{}}
                    onUpdate={(si,val)=>updateSet(selDay,ex.id,si,val)} />
                ))}

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
            <div style={{fontSize:7,letterSpacing:3,color:"#4a6a4a",marginBottom:8}}>COACH AI // R:{oura.readiness} // {tier} // HRV:{oura.hrv}ms // BACK:{backPain}/10 // WK{week} // {nutTotals.cal}cal/{nutTotals.protein}g logged</div>
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
            <div style={{fontSize:7,letterSpacing:3,color:"#4a6a4a",marginBottom:10}}>SESSION LOG // {logDate} // {tier} // WK {week}</div>
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
