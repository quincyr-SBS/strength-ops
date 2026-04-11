// src/hooks/useOuraSync.js
//
// Fetches live Oura data from Val.town proxy on mount.
// Caches for 30 minutes in localStorage.
// Falls back to cached data on error.
// Manual override persists across syncs.

import { useState, useEffect, useCallback } from "react";

const VALTOWN_URL  = "https://qwroundtree-ouraauth.web.val.run/data";
const LS_BASELINE  = "sqb_rhr_baseline";
const LS_CACHE     = "sqb_oura_cache";
const LS_CACHE_TS  = "sqb_oura_cache_ts";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const FALLBACK = {
  readiness:     80,
  hrv:           48,
  hrv7day:       52,
  rhr:           58,
  rhrBaseline:   55,
  sleepScore:    null,
  totalSleepHrs: null,
  deepSleepHrs:  null,
  remSleepHrs:   null,
  contributors:  {},
  dataDate:      null,
  source:        "manual",
};

export function useOuraSync() {
  const [oura, setOura] = useState(() => {
    // Hydrate from cache on first load so UI is never blank
    try {
      const cached = localStorage.getItem(LS_CACHE);
      const ts     = localStorage.getItem(LS_CACHE_TS);
      if (cached && ts && Date.now() - Number(ts) < CACHE_TTL_MS) {
        return { ...FALLBACK, ...JSON.parse(cached), source: "cache" };
      }
    } catch {}
    return FALLBACK;
  });

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [lastSync, setLastSync] = useState(null);

  const fetchOura = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(VALTOWN_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Preserve user-set rhrBaseline from localStorage
      const storedBaseline = localStorage.getItem(LS_BASELINE);
      const rhrBaseline = storedBaseline
        ? Number(storedBaseline)
        : data.rhr ?? FALLBACK.rhrBaseline;

      const merged = {
        ...FALLBACK,
        ...data,
        rhrBaseline,
        source: "oura",
      };

      setOura(merged);
      setLastSync(new Date());

      // Cache result
      localStorage.setItem(LS_CACHE,    JSON.stringify(merged));
      localStorage.setItem(LS_CACHE_TS, String(Date.now()));

    } catch (err) {
      setError(err.message);
      // Keep existing state on error — never wipe valid data
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch on mount
  useEffect(() => {
    fetchOura();
  }, [fetchOura]);

  // Manual override — merges on top of live data
  const setManualOverride = useCallback((overrides) => {
    setOura(prev => ({ ...prev, ...overrides, source: "manual_override" }));
    // Persist baseline separately so it survives re-syncs
    if (overrides.rhrBaseline !== undefined) {
      localStorage.setItem(LS_BASELINE, String(overrides.rhrBaseline));
    }
  }, []);

  return {
    oura,
    loading,
    error,
    lastSync,
    refresh: fetchOura,
    setManualOverride,
  };
}