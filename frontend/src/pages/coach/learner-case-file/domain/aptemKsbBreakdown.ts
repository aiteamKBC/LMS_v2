export interface AptemKsbRow {
  code: string;
  description: string;
  category: string;
  components: Array<{ name: string; status: string; achieved: boolean; source?: string }>;
  activityNames?: string[];
  activityCount?: number;
  completed: number;
  status: 'Achieved' | 'Not Achieved';
}
export interface AptemKsbBreakdown {
  rows: AptemKsbRow[];
  source?: 'aptem' | 'new_lms' | 'progress';
  totalKsbs?: number;
  remainingKsbs?: number;
  achievedKsbs: number;
}
export function selectAptemKsbGroups(rows: AptemKsbRow[], source: AptemKsbBreakdown['source'] = 'aptem') {
  return rows.map((row) => ({
    ...row,
    id: row.code,
    activities: row.activityNames ? row.activityNames.map(name => ({ activityTitle: name, evidenceActivities: [] as Array<{ title: string; type: string; source: string; status: string; achievesKsb: boolean }> })) : row.components.map((component) => ({
      activityTitle: component.name,
      evidenceActivities: [{ title: component.name, type: 'Component', source: component.source || (source === 'progress' ? 'Progress' : source === 'new_lms' ? 'LMS' : 'Aptem'), status: component.status, achievesKsb: component.achieved }],
    })),
  }));
}

export function summarizeAptemKsbGroups(rows: AptemKsbRow[], available = true) {
  const summarize = (items: AptemKsbRow[]) => {
    const total = available ? items.length : null;
    const achieved = available ? items.filter((item) => item.status === 'Achieved').length : null;
    return { total, achieved, remaining: total !== null && achieved !== null ? total - achieved : null,
      percent: total !== null && achieved !== null ? (total ? Math.round(achieved / total * 100) : 0) : null };
  };
  return { ...summarize(rows), categories: new Map(
    Array.from(new Set(['Knowledge', 'Skills', 'Behaviours', ...rows.map((row) => row.category)]))
      .map((category) => [category, summarize(rows.filter((row) => row.category === category))]),
  ) };
}
