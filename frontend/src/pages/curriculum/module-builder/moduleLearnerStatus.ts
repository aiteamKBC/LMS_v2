export const moduleLearnerStatuses = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'on break', label: 'On break' },
  { value: 'completed', label: 'Completed' },
  { value: 'enteredepa', label: 'Entered EPA' },
];

export function moduleLearnerStatus(value: string) {
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (key.replace(/ /g, '') === 'enteredepa') return 'enteredepa';
  if (key === 'onbreak' || key === 'on a break') return 'on break';
  return key || 'unknown';
}
