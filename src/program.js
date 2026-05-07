// Pure program-logic helpers — no React, no DOM, no I/O.
// Exported for direct import by App.jsx and for unit tests.

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK CONFIG
// ─────────────────────────────────────────────────────────────────────────────
export const BLOCK_RANK = { A:0, B:1, C:2, D:3 };
export const BLOCK_CONFIG = {
  A: { name:"FOUNDATION",         color:"#6aaa6a", desc:"Trap-bar high handle, goblet box squat, DB bench/OHP, accessory curls. Build the base." },
  B: { name:"BARBELL TRANSITION", color:"#facc15", desc:"SSB squat, seated BB OHP, shoulder prehab. Spine ready for higher absolute loads." },
  C: { name:"STRENGTH",           color:"#fb923c", desc:"Conventional/sumo from blocks, standing strict press. Approach elite numbers." },
  D: { name:"PEAK",               color:"#ef4444", desc:"Wave loading, lower volume, peak the targets." },
};
export const blockLabel = (b) => `BLOCK ${b} — ${BLOCK_CONFIG[b].name}`;

// Anchor exercises — all must clear final-step gate before block advance is suggested.
// Extend as each block fills out: B_TO_C currently lists only the two Block-B headline lifts;
// C_TO_D is empty until Block C ships, which keeps the advance button hidden by design.
export const BLOCK_TRANSITION_ANCHORS = {
  A_TO_B: ["trap_bar","goblet_sq","db_bench_mon","seated_db_press"],
  B_TO_C: ["ssb_squat","seated_bb_ohp"],
  C_TO_D: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM BUILDERS
// ─────────────────────────────────────────────────────────────────────────────
export const G = {
  rpe:     (rpe, sessions = 2)         => ({ type:"RPE_BELOW",       rpe, sessions }),
  rpePain: (rpe, pain = 2, sessions=3) => ({ type:"RPE_PAIN",        rpe, pain, sessions }),
  weeks:   (weeks, pain = 2)           => ({ type:"PAIN_FREE_WEEKS", weeks, pain }),
  none:    ()                          => null,
};
export const S = (sets, reps, load, loadNum, rpe, gate) => ({ sets, reps, load, loadNum, rpe, gate });

// ─────────────────────────────────────────────────────────────────────────────
// GATE EVALUATOR
// ─────────────────────────────────────────────────────────────────────────────
export function isoWeekKey(dateStr){
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,"0")}`;
}

export function evaluateGate(gate, stepHistory){
  if (!gate) return { cleared:false, progress:"—", note:"maintenance — no progression gate" };
  const completed = (stepHistory||[]).filter(h => h.completed);
  // Legacy entries logged before tier-tracking landed are treated as HARD so
  // existing progress doesn't regress when the HARD-confirmation rule lands.
  const isHard = (h) => (h.tier ?? "HARD") === "HARD";
  if (gate.type === "RPE_BELOW"){
    const need   = gate.sessions;
    const lastN  = completed.slice(-need);
    const pass   = lastN.filter(h => (h.topRPE ?? 99) <= gate.rpe).length;
    const cleared= lastN.length >= need && pass === need;
    return { cleared, progress:`${pass}/${need}`, note:`top-set RPE ≤ ${gate.rpe} for ${need} sessions` };
  }
  if (gate.type === "RPE_PAIN"){
    const need   = gate.sessions;
    const lastN  = completed.slice(-need);
    const pass   = lastN.filter(h =>
      (h.topRPE ?? 99) <= gate.rpe &&
      (h.painBack ?? 99) <= gate.pain &&
      (h.painShoulder ?? 99) <= gate.pain
    ).length;
    const allClean    = lastN.length >= need && pass === need;
    const hasHard     = lastN.some(isHard);
    const cleared     = allClean && hasHard;
    const suffix      = allClean && !hasHard ? " · awaiting HARD-tier confirmation" : "";
    return { cleared, progress:`${pass}/${need}${suffix}`, note:`RPE ≤ ${gate.rpe} + pain ≤ ${gate.pain}/10 × ${need} (incl. ≥1 HARD-tier session)` };
  }
  if (gate.type === "PAIN_FREE_WEEKS"){
    const weeks = new Set();
    let hasHardInQualifying = false;
    for (const h of completed){
      if ((h.painBack ?? 99) > gate.pain) continue;
      if ((h.painShoulder ?? 99) > gate.pain) continue;
      const wk = isoWeekKey(h.date);
      if (wk) weeks.add(wk);
      if (isHard(h)) hasHardInQualifying = true;
    }
    const weeksHit  = weeks.size >= gate.weeks;
    const cleared   = weeksHit && hasHardInQualifying;
    const suffix    = weeksHit && !hasHardInQualifying ? " · awaiting HARD-tier confirmation" : "";
    return { cleared, progress:`${Math.min(weeks.size, gate.weeks)}/${gate.weeks}${suffix}`, note:`${gate.weeks} pain-free weeks (pain ≤ ${gate.pain}/10) + ≥1 HARD-tier session — phase transition` };
  }
  return { cleared:false, progress:"?", note:"unknown gate type" };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP STATE + BLOCK DERIVATION
// stepState shape: { [exId]: { stepIdx:int, history:[{date,stepIdx,topRPE,painBack,painShoulder,completed:true}] } }
// ─────────────────────────────────────────────────────────────────────────────
export function getStepState(stepState, exId){
  return stepState[exId] || { stepIdx:0, history:[] };
}
export function findExerciseById(program, id){
  for (const dk of Object.keys(program)){
    const ex = (program[dk].exercises||[]).find(e => e.id === id);
    if (ex) return ex;
  }
  return null;
}
export function isBlockTransitionReady(stepState, program, anchorIds){
  if (!anchorIds || anchorIds.length === 0) return false;
  for (const exId of anchorIds){
    const ex = findExerciseById(program, exId);
    if (!ex) return false;
    const st = getStepState(stepState, exId);
    if (st.stepIdx < ex.progression.length - 1) return false;
    const finalGate = ex.progression[ex.progression.length - 1].gate;
    const res = evaluateGate(finalGate, st.history.filter(h => h.stepIdx === st.stepIdx));
    if (!res.cleared) return false;
  }
  return true;
}
export function getVisibleExercises(dayExercises, currentBlock){
  const cur = BLOCK_RANK[currentBlock];
  return (dayExercises||[]).filter(ex => {
    const r = BLOCK_RANK[ex.block];
    if (r > cur) return false;
    if (r < cur){
      // Hidden if any unlocked higher-block exercise replaces it (so Block-B
      // supersessions of Block A persist after advancing to Block C).
      return !dayExercises.some(o =>
        BLOCK_RANK[o.block] > r && BLOCK_RANK[o.block] <= cur && o.replaces === ex.id
      );
    }
    return true;
  });
}
export function getLockedPreview(dayExercises, currentBlock){
  const cur = BLOCK_RANK[currentBlock];
  return (dayExercises||[]).filter(ex => BLOCK_RANK[ex.block] === cur + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-DELOAD TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────
export function evaluateDeloadTriggers(readinessHistory){
  const triggers = [];
  const h = readinessHistory || [];
  if (h.length >= 4){
    const last4 = h.slice(-4);
    if (last4.every(d => Number(d.readiness) < 70)) triggers.push("Readiness <70 × 4 days — deload");
  }
  if (h.length >= 3){
    const last3 = h.slice(-3);
    if (last3.every(d => d.hrv && d.hrv7day && (Number(d.hrv7day) - Number(d.hrv)) >= 3))
      triggers.push("HRV ↓ 3+ ms vs 7d avg × 3 days — deload");
  }
  return triggers;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD SCALING (MODERATE tier scales numeric loads to 80%)
// ─────────────────────────────────────────────────────────────────────────────
export function scaleLoad(load, mult) {
  if (mult === 1.0) return load;
  return load.replace(/(\d+)/g, (m) => Math.round(parseInt(m)*mult/5)*5);
}

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION — seek the closest progression step to a user's current load.
// Used when a new user enters their existing working weights so the program
// starts where they actually are, not at step 0.
// ─────────────────────────────────────────────────────────────────────────────
export function seekStepByLoad(progression, targetLoad){
  if (!progression || progression.length === 0) return 0;
  const target = Number(targetLoad);
  if (!Number.isFinite(target) || target <= 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < progression.length; i++){
    const dist = Math.abs(Number(progression[i].loadNum) - target);
    if (dist < bestDist){ bestDist = dist; bestIdx = i; }
  }
  return bestIdx;
}

// Apply a batch of calibrations: { [exId]: currentLoad }.
// Returns next stepState. For each calibrated exercise, sets stepIdx to the
// closest progression step and clears history at that step so the gate starts
// from a clean slate. Exercises not in `calibrations` (or with empty values)
// are left untouched.
export function applyCalibration(stepState, program, calibrations){
  const next = { ...stepState };
  for (const [exId, load] of Object.entries(calibrations || {})){
    if (load === "" || load === null || load === undefined) continue;
    const ex = findExerciseById(program, exId);
    if (!ex || !ex.progression) continue;
    const newIdx = seekStepByLoad(ex.progression, load);
    const prev = stepState[exId] || { stepIdx:0, history:[] };
    // Drop any history at the new step so the gate restarts fresh; keep history
    // from other steps so prior progress at lower loads remains in the record.
    const history = (prev.history || []).filter(h => h.stepIdx !== newIdx);
    next[exId] = { stepIdx: newIdx, history };
  }
  return next;
}
