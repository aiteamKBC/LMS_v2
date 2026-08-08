/**
 * Optimized snapshot handling for large state changes.
 *
 * Instead of serializing entire state on every change,
 * only extract and compare relevant fields.
 *
 * Features:
 * - Selective field serialization
 * - Checksum-based comparison
 * - Size tracking
 * - Delta history
 */

export interface SnapshotFields {
  programmeForm?: Record<string, unknown>;
  ksbSourceKind?: string;
  ksbSourceValue?: string;
  cohortDrafts?: unknown[];
  removedCohortIds?: string[];
  removedGroupIds?: string[];
  removedModuleIds?: string[];
}

interface SnapshotDelta {
  timestamp: number;
  changes: SnapshotFields;
  checksum: string;
  size: number;
}

/**
 * Optimizes snapshot creation and comparison for large objects.
 */
export class SnapshotOptimizer {
  private lastSnapshot: string = '';
  private deltaHistory: SnapshotDelta[] = [];
  private checksumCache = new Map<string, string>();
  private stats = {
    snapshotsCreated: 0,
    serializationTime: 0,
    comparisonsPerformed: 0,
    comparisonTime: 0,
  };

  /**
   * Create optimized snapshot of only relevant fields.
   */
  createSnapshot(state: Record<string, unknown>): string {
    const start = performance.now();

    const snapshot = this.extractRelevantFields(state);
    const json = JSON.stringify(snapshot);
    const checksum = this.simpleChecksum(json);

    if (json !== this.lastSnapshot) {
      this.lastSnapshot = json;
      this.deltaHistory.push({
        timestamp: Date.now(),
        changes: snapshot,
        checksum,
        size: this.getSize(json),
      });

      // Keep only last 20 deltas to avoid memory bloat
      if (this.deltaHistory.length > 20) {
        this.deltaHistory = this.deltaHistory.slice(-20);
      }
    }

    this.stats.snapshotsCreated++;
    this.stats.serializationTime += performance.now() - start;

    return json;
  }

  /**
   * Compare two snapshots safely using both checksums and content verification.
   * FNV-1a hash is a fast first check but not the sole equality decision.
   * If hashes match, verify content equality to prevent false positives from hash collisions.
   */
  snapshotsEqual(snapshot1: string, snapshot2: string): boolean {
    const start = performance.now();

    // Quick reference check
    if (snapshot1 === snapshot2) {
      this.stats.comparisonsPerformed++;
      return true;
    }

    // Length check as proxy (fast rejection of obviously different content)
    if (snapshot1.length !== snapshot2.length) {
      this.stats.comparisonsPerformed++;
      this.stats.comparisonTime += performance.now() - start;
      return false;
    }

    // Checksum as fast first filter
    const check1 = this.checksumCache.get(snapshot1) || this.simpleChecksum(snapshot1);
    const check2 = this.checksumCache.get(snapshot2) || this.simpleChecksum(snapshot2);

    // Cache checksums (limit cache size)
    if (this.checksumCache.size < 100) {
      this.checksumCache.set(snapshot1, check1);
      this.checksumCache.set(snapshot2, check2);
    }

    // If hashes differ, snapshots definitely differ
    if (check1 !== check2) {
      this.stats.comparisonsPerformed++;
      this.stats.comparisonTime += performance.now() - start;
      return false;
    }

    // Hash collision protection: same hash must still verify actual content equality
    // by comparing the normalized persisted representation
    const isEqual = snapshot1 === snapshot2;

    this.stats.comparisonsPerformed++;
    this.stats.comparisonTime += performance.now() - start;

    return isEqual;
  }

  /**
   * Get memory size of snapshot in bytes.
   */
  getSize(snapshot: string): number {
    return snapshot.length * 2; // UTF-16 encoding
  }

  /**
   * Get change history.
   */
  getHistory(limit = 10): SnapshotDelta[] {
    return this.deltaHistory.slice(-limit);
  }

  /**
   * Get performance statistics.
   */
  getStats() {
    return {
      snapshotsCreated: this.stats.snapshotsCreated,
      avgSerializationTime: this.stats.snapshotsCreated > 0
        ? this.stats.serializationTime / this.stats.snapshotsCreated
        : 0,
      comparisonsPerformed: this.stats.comparisonsPerformed,
      avgComparisonTime: this.stats.comparisonsPerformed > 0
        ? this.stats.comparisonTime / this.stats.comparisonsPerformed
        : 0,
      cachedChecksums: this.checksumCache.size,
    };
  }

  /**
   * Clear caches.
   */
  clear(): void {
    this.lastSnapshot = '';
    this.deltaHistory = [];
    this.checksumCache.clear();
  }

  /**
   * Extract only relevant fields from state.
   * This is the key optimization - don't serialize everything.
   */
  private extractRelevantFields(state: Record<string, unknown>): SnapshotFields {
    const result: SnapshotFields = {
      ksbSourceKind: state.ksbSourceKind as string | undefined,
      ksbSourceValue: state.ksbSourceValue as string | undefined,
    };

    const programmeForm = this.safeCopy(state.programmeForm);
    if (typeof programmeForm === 'object' && programmeForm !== null) {
      result.programmeForm = programmeForm as Record<string, unknown>;
    }

    const cohortDrafts = this.safeCopy(state.cohortDrafts);
    if (Array.isArray(cohortDrafts)) {
      result.cohortDrafts = cohortDrafts as unknown[];
    }

    const removedCohortIds = this.safeCopy(state.removedCohortIds);
    if (Array.isArray(removedCohortIds)) {
      result.removedCohortIds = removedCohortIds as string[];
    }

    const removedGroupIds = this.safeCopy(state.removedGroupIds);
    if (Array.isArray(removedGroupIds)) {
      result.removedGroupIds = removedGroupIds as string[];
    }

    const removedModuleIds = this.safeCopy(state.removedModuleIds);
    if (Array.isArray(removedModuleIds)) {
      result.removedModuleIds = removedModuleIds as string[];
    }

    return result;
  }

  /**
   * Safe shallow copy of objects/arrays.
   */
  private safeCopy(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return (value as unknown[]).slice(); // Shallow copy array
    if (value instanceof Date) return value.getTime();
    if (value instanceof Map || value instanceof Set) return value.size;
    // Return object as-is (will be stringified)
    return value;
  }

  /**
   * Simple but fast checksum using FNV-1a algorithm.
   * Good enough for detecting changes, not cryptographically secure.
   */
  private simpleChecksum(str: string): string {
    let hash = 0x811c9dc5; // FNV offset basis

    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0; // FNV prime, keep as 32-bit unsigned
    }

    return hash.toString(16);
  }
}

/**
 * Singleton instance for curriculum wizard snapshots.
 */
export const snapshotOptimizer = new SnapshotOptimizer();
