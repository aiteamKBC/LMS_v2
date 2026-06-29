import { ASSIGNMENT_PROGRESS } from '@/mocks/monthly-cycle';

const statusColor: Record<string, string> = {
  'Good': 'text-emerald-700 bg-emerald-50',
  'On Track': 'text-emerald-700 bg-emerald-50',
  'Needs Work': 'text-amber-700 bg-amber-50',
  'Behind': 'text-red-700 bg-red-50',
};

export default function AssignmentProgress() {
  const d = ASSIGNMENT_PROGRESS;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center gap-2 mb-1">
        <i className="ri-file-text-line text-foreground-600 text-sm"></i>
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Monthly Assignment</h3>
      </div>
      <p className="text-xs text-foreground-400 mb-1">Due {d.dueDate} · <span className="text-primary-600 font-semibold bg-primary-50 px-1.5 py-0.5 rounded">Open</span></p>
      <p className="text-sm text-foreground-600 mb-1">
        Portfolio report auto-pulls weekly reflections, evidence, quiz results, OTJH logs, KSB claims,{' '}
        <span className="text-primary-600">attendance</span> and coach feedback.{' '}
        <span className="text-primary-600">Review, edit and submit.</span>
      </p>

      {/* Auto-generated readiness */}
      <div className="flex items-center gap-2 mt-3 mb-4">
        <span className="text-[10px] font-bold bg-secondary-50 text-secondary-700 px-2 py-0.5 rounded-full">Auto-Generated Readiness</span>
        <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
          <div className="h-full bg-secondary-500 rounded-full transition-all duration-700" style={{ width: `${d.overallReadiness}%` }}></div>
        </div>
        <span className="text-xs font-bold text-secondary-700">{d.overallReadiness}%</span>
      </div>

      {/* Evidence Sources */}
      <p className="text-xs font-semibold text-foreground-500 mb-2">Portfolio Evidence Sources</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {d.evidenceSources.map((src) => (
          <div key={src.label} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-background-200/50 bg-background-50/50">
            <div className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center shrink-0">
              <i className={`${src.icon} text-foreground-500 text-sm`}></i>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground-700">{src.label}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusColor[src.status]}`}>{src.status}</span>
              </div>
              <p className="text-[11px] text-foreground-400 mt-0.5 truncate">{src.detail}</p>
              {src.percentage !== undefined && (
                <div className="mt-1 h-1 bg-background-200 rounded-full overflow-hidden w-full max-w-[100px]">
                  <div className={`h-full rounded-full ${src.percentage >= 80 ? 'bg-emerald-500' : src.percentage >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${src.percentage}%` }}></div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button className="mt-4 px-4 py-2 bg-foreground-900 text-white rounded-lg text-sm font-semibold hover:bg-foreground-700 transition-smooth cursor-pointer whitespace-nowrap">
        Open Assignment
      </button>
    </div>
  );
}