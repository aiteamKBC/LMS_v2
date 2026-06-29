import { MONTH_SUMMARY, MONTHS_META } from '@/mocks/monthly-cycle';

interface MonthSummaryPanelProps {
  month: string;
}

const statusColor: Record<string, string> = {
  'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'In Progress': 'bg-primary-50 text-primary-700 border-primary-200',
  'Not Started': 'bg-background-100 text-foreground-400 border-background-200',
  'Submitted': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Due 20 Jun': 'bg-amber-50 text-amber-700 border-amber-200',
  'Due 20 Jul': 'bg-amber-50 text-amber-700 border-amber-200',
  'Due 20 May': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Pending': 'bg-amber-50 text-amber-700 border-amber-200',
  '21–30 Jun': 'bg-background-100 text-foreground-500 border-background-200',
  '21–31 Jul': 'bg-background-100 text-foreground-500 border-background-200',
  '21–31 May': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export default function MonthSummaryPanel({ month }: MonthSummaryPanelProps) {
  const meta = MONTHS_META.find(m => m.key === month);
  const data = MONTH_SUMMARY[month as keyof typeof MONTH_SUMMARY];
  if (!data) return null;

  const scoreColor = data.overallScore >= 80 ? 'text-emerald-600' : data.overallScore >= 50 ? 'text-primary-600' : data.overallScore > 0 ? 'text-amber-600' : 'text-foreground-400';
  const scoreBg = data.overallScore >= 80 ? 'bg-emerald-100' : data.overallScore >= 50 ? 'bg-primary-100' : data.overallScore > 0 ? 'bg-amber-100' : 'bg-background-100';

  const items = [
    { label: 'OTJH', value: data.otjh, icon: 'ri-time-line' },
    { label: 'Attendance', value: data.attendance, icon: 'ri-calendar-check-line' },
    { label: 'Assignment', value: data.assignment, icon: 'ri-file-text-line' },
    { label: 'Coaching', value: data.coaching, icon: 'ri-user-voice-line' },
    { label: 'Checkpoint', value: data.checkpoint, icon: 'ri-questionnaire-line' },
    { label: 'Evidence', value: data.evidence, icon: 'ri-folder-upload-line' },
    { label: 'KSB Progress', value: data.ksbProgress, icon: 'ri-bar-chart-2-line' },
  ];

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 pb-4 border-b border-background-200/50">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${scoreBg}`}>
          <span className={`text-xl font-bold font-heading ${scoreColor}`}>{data.overallScore}</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">{meta?.label} — Summary</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor[data.status] || 'bg-background-100 text-foreground-400'}`}>
              {data.status}
            </span>
          </div>
          <p className="text-xs text-foreground-400 mt-0.5">Completion target: {data.completionDate}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {items.map(item => (
          <div key={item.label} className="p-2.5 rounded-lg border border-background-200/50 bg-background-50/50">
            <div className="flex items-center gap-1.5 mb-1">
              <i className={`${item.icon} text-foreground-400 text-[10px]`}></i>
              <span className="text-[10px] font-medium text-foreground-500">{item.label}</span>
            </div>
            <p className="text-xs font-semibold text-foreground-800">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}