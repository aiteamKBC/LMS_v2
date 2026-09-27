export const caseFileTabs = [
  { id: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { id: 'progress', label: 'OTJH & KSB Progress', icon: 'ri-line-chart-line' },
  { id: 'attendance', label: 'Attendance', icon: 'ri-calendar-check-line' },
  { id: 'support', label: 'Learning Plan', icon: 'ri-route-line' },
  { id: 'reviews', label: 'Reviews', icon: 'ri-file-list-3-line' },
  { id: 'assignments', label: 'Assignments', icon: 'ri-file-text-line' },
  { id: 'otjh', label: 'OTJH', icon: 'ri-time-line', hidden: true },
  { id: 'ksbs', label: 'KSBs', icon: 'ri-award-line', hidden: true },
  { id: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line', hidden: true },
  { id: 'audit', label: 'Audit', icon: 'ri-file-search-line', hidden: true },
  { id: 'activity', label: 'Activity', icon: 'ri-history-line', hidden: true },
  { id: 'network', label: 'Network', icon: 'ri-user-heart-line', hidden: true },
  { id: 'documents', label: 'Documents', icon: 'ri-folder-line', hidden: true },
] as const;

export type CaseFileTabId = typeof caseFileTabs[number]['id'] | 'coach-notes';
