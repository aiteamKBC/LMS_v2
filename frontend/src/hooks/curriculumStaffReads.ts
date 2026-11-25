/** Staff failures must remain visible while independent curriculum reads succeed. */
export function curriculumStaffReadError(
  tutors: PromiseSettledResult<unknown>,
  coaches: PromiseSettledResult<unknown>,
): string | null {
  const failed = [
    tutors.status === 'rejected' ? 'tutors' : '',
    coaches.status === 'rejected' ? 'coaches' : '',
  ].filter(Boolean);
  return failed.length
    ? `Unable to load ${failed.join(' and ')}. Staff options may be incomplete or out of date. Please retry.`
    : null;
}
