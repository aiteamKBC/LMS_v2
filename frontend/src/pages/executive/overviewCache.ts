import type { LiveQmsData } from "./qualityData";

/** How long cached overview data is shown without a background refresh. */
export const OVERVIEW_CACHE_FRESH_MS = 60_000;

let cached: { data: LiveQmsData; at: number } | null = null;

export const readOverviewCache = () => cached;
export const writeOverviewCache = (data: LiveQmsData) => { cached = { data, at: Date.now() }; };
export const clearOverviewCache = () => { cached = null; };
