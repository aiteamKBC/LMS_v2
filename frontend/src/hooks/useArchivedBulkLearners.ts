import { useCallback, useEffect, useState } from "react";

const MANUAL_KEY = "lumina-attendance-archive-manual";
const RESTORED_KEY = "lumina-attendance-archive-restored";
// Legacy key from the earlier manual-only archive; migrated on load.
const LEGACY_KEY = "lumina-attendance-archive";

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

interface UseArchivedLearnersResult {
  /** Learners the user archived by hand (early / manual archive). */
  manualIds: string[];
  /** Learners explicitly restored, kept out of auto-archiving. */
  restoredIds: string[];
  archiveMany: (learnerIds: string[]) => void;
  restoreMany: (learnerIds: string[]) => void;
}

/**
 * Persists which learners are manually archived and which have been restored.
 * Learners who pass their end date are derived as archived elsewhere, so this
 * hook only owns the two human-driven overrides. Both survive a refresh while
 * the attendance page is open.
 */
export function useArchivedLearners(): UseArchivedLearnersResult {
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [restoredIds, setRestoredIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const storedManual = readList(MANUAL_KEY);
    const migrated =
      storedManual.length === 0 ? readList(LEGACY_KEY) : storedManual;
    setManualIds(migrated);
    setRestoredIds(readList(RESTORED_KEY));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(MANUAL_KEY, JSON.stringify(manualIds));
    } catch {
      // Ignore write failures (private mode, quota, etc.)
    }
  }, [manualIds, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(RESTORED_KEY, JSON.stringify(restoredIds));
    } catch {
      // Ignore write failures (private mode, quota, etc.)
    }
  }, [restoredIds, loaded]);

  const archiveMany = useCallback((learnerIds: string[]) => {
    setManualIds((prev) => Array.from(new Set([...prev, ...learnerIds])));
    setRestoredIds((prev) => prev.filter((id) => !learnerIds.includes(id)));
  }, []);

  const restoreMany = useCallback((learnerIds: string[]) => {
    setManualIds((prev) => prev.filter((id) => !learnerIds.includes(id)));
    setRestoredIds((prev) => Array.from(new Set([...prev, ...learnerIds])));
  }, []);

  return {
    manualIds,
    restoredIds,
    archiveMany,
    restoreMany,
  };
}
