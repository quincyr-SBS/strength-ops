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
  // Parse as UTC explicitly (append "Z") so the date math is timezone-invariant.
  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,"0")}`;
}

export function evaluateGate(gate, stepHistory){
  if (!gate) return { cleared:false, progress:"—", note:"maintenance — no progression gate" };
  // DELOAD and RECOVERY sessions are intentionally excluded — they're back-off
  // periods that should not count toward step advancement.
  const completed = (stepHistory||[])
    .filter(h => h.completed)
    .filter(h => h.tier !== "DELOAD" && h.tier !== "RECOVERY");
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
    // Track HARD-ness per ISO week. The qualifying window is the most recent
    // `gate.weeks` distinct pain-free weeks; HARD must appear within that
    // window (not any HARD across all history at this step).
    const weekHard = new Map();  // isoWeek -> bool (any HARD session that week)
    for (const h of completed){
      if ((h.painBack ?? 99) > gate.pain) continue;
      if ((h.painShoulder ?? 99) > gate.pain) continue;
      const wk = isoWeekKey(h.date);
      if (!wk) continue;
      weekHard.set(wk, (weekHard.get(wk) || false) || isHard(h));
    }
    const allWeeks      = [...weekHard.keys()].sort();   // ISO keys sort lexicographically
    const recentWindow  = allWeeks.slice(-gate.weeks);   // (renamed from `window` to avoid shadowing the global)
    const weeksHit      = recentWindow.length >= gate.weeks;
    const hardInWindow  = recentWindow.some(wk => weekHard.get(wk));
    const cleared       = weeksHit && hardInWindow;
    const suffix        = weeksHit && !hardInWindow ? " · awaiting HARD-tier confirmation in window" : "";
    return { cleared, progress:`${Math.min(allWeeks.length, gate.weeks)}/${gate.weeks}${suffix}`, note:`${gate.weeks} pain-free weeks (pain ≤ ${gate.pain}/10) with ≥1 HARD session in window — phase transition` };
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
// Only scales numbers immediately followed by "lb" so that time strings
// (e.g. "× 30s") and count strings (e.g. "4 directions") in the load field
// are left alone.
// ─────────────────────────────────────────────────────────────────────────────
export function scaleLoad(load, mult) {
  if (mult === 1.0) return load;
  return load.replace(/(\d+)(?=\s*lb)/g, (m) => Math.round(parseInt(m)*mult/5)*5);
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

// ─────────────────────────────────────────────────────────────────────────────
// DELOAD WEEK — manual start / end, with a soft suggestion every N weeks.
// Sessions logged during an active deload are tagged tier:"DELOAD" and excluded
// from gate progression by evaluateGate.
//
// deloadState shape:
//   { current: { startedOn, endsOn } | null,
//     history: [{ startedOn, endsOn, endsOnActual? }, ...] }
// ─────────────────────────────────────────────────────────────────────────────
export const DELOAD_DURATION_DAYS       = 7;
export const DELOAD_LOAD_MULT           = 0.6;
export const DELOAD_SUGGEST_AFTER_WEEKS = 6;

// Parse ISO date strings as UTC (append "Z") so date math is timezone-invariant.
// Without this, addDays/daysBetween parsed in local TZ and then used UTC getters,
// producing off-by-one errors in positive-offset timezones.
export function addDays(dateISO, n){
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}
export function daysBetween(fromISO, toISO){
  const f = new Date(fromISO + "T00:00:00Z");
  const t = new Date(toISO   + "T00:00:00Z");
  return Math.round((t - f) / 86400000);
}

export function getActiveDeload(deloadState, todayISO){
  const cur = deloadState?.current;
  if (!cur) return null;
  // endsOn is inclusive — deload is active through that calendar day
  if (cur.endsOn < todayISO) return null;
  return { ...cur, daysRemaining: daysBetween(todayISO, cur.endsOn) + 1 };
}

export function startDeload(todayISO, days = DELOAD_DURATION_DAYS){
  return { startedOn: todayISO, endsOn: addDays(todayISO, days - 1) };
}

// Move current deload (if any) into history, stamping today as actual end.
// If no active deload, returns the state unchanged.
export function endDeload(deloadState, todayISO){
  const cur = deloadState?.current;
  if (!cur) return deloadState || { current:null, history:[] };
  return {
    current: null,
    history: [...(deloadState.history || []), { ...cur, endsOnActual: todayISO }],
  };
}

// If `current` exists but has expired (endsOn < today), move it to history.
// Active deloads and null states pass through unchanged. Called by the UI on
// mount so a user who lets a deload window expire without clicking END EARLY
// still has the deload counted toward weeksSinceLastDeload.
export function archiveExpiredDeload(deloadState, todayISO){
  const cur = deloadState?.current;
  if (!cur) return deloadState || { current:null, history:[] };
  if (cur.endsOn >= todayISO) return deloadState; // still active
  return {
    current: null,
    history: [...(deloadState.history || []), { ...cur, endsOnActual: cur.endsOn }],
  };
}

// Find the earliest logged session across all exercises (used as the reference
// point for weeksSinceLastDeload when the user has never deloaded).
function earliestSessionDate(stepState){
  let earliest = null;
  for (const ex of Object.values(stepState || {})){
    for (const h of (ex.history || [])){
      if (!h.date) continue;
      if (!earliest || h.date < earliest) earliest = h.date;
    }
  }
  return earliest;
}

// Whole weeks since the most recent deload ended (or, if never deloaded, since
// the earliest logged session). Returns null when the user has no training
// history at all — no point suggesting a deload before they've trained.
//
// Defensive: if `current` exists and has expired (endsOn < today) but the UI
// hasn't archived it yet, treat it as the most recent deload so the count
// doesn't reset to "never deloaded."
export function weeksSinceLastDeload(deloadState, stepState, todayISO){
  const hist = [...(deloadState?.history || [])];
  const cur = deloadState?.current;
  if (cur && cur.endsOn < todayISO){
    hist.push({ ...cur, endsOnActual: cur.endsOn });
  }
  const lastDeload = hist.length ? hist[hist.length - 1] : null;
  const referenceISO = lastDeload
    ? (lastDeload.endsOnActual ?? lastDeload.endsOn)
    : earliestSessionDate(stepState);
  if (!referenceISO) return null;
  const d = daysBetween(referenceISO, todayISO);
  return d < 0 ? 0 : Math.floor(d / 7);
}
