/** Programme statuses that move a learner out of the register into the archive. */
const ARCHIVED_STATUSES = new Set(["completed", "enteredepa", "withdrawn"]);

export function statusKey(status: string | undefined): string {
  return (status ?? "").toLowerCase().replace(/[\s_-]+/g, "");
}

export function isArchivedStatus(status: string | undefined): boolean {
  return ARCHIVED_STATUSES.has(statusKey(status));
}
