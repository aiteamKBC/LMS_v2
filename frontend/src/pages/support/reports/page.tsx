import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const supportConfig = roleNavMap.support;

const REPORT_METRICS = [
  { label: 'Tickets Created (7d)', value: '173', trend: '+12%', icon: 'ri-ticket-line', color: 'primary' },
  { label: 'Avg Resolution Time', value: '4.2h', trend: '-18%', icon: 'ri-timer-line', color: 'emerald' },
  { label: 'First Response SLA', value: '94%', trend: '+3%', icon: 'ri-shield-check-line', color: 'emerald' },
  { label: 'Customer Satisfaction', value: '4.7/5', trend: '+0.2', icon: 'ri-star-line', color: 'accent' },
];

const WEEKLY_TREND = [
  { day: 'Mon', created: 28, resolved: 24, escalated: 2 },
  { day: 'Tue', created: 32, resolved: 29, escalated: 1 },
  { day: 'Wed', created: 26, resolved: 31, escalated: 3 },
  { day: 'Thu', created: 35, resolved: 28, escalated: 2 },
  { day: 'Fri', created: 29, resolved: 33, escalated: 1 },
  { day: 'Sat', created: 14, resolved: 18, escalated: 0 },
  { day: 'Sun', created: 9, resolved: 12, escalated: 0 },
];

export default function SupportReports() {
  return (
    <WorkspaceShell
      role="support"
      roleLabel={supportConfig.label}
      navItems={supportConfig.items}
      pageTitle="Support Reports"
      pageSubtitle="Ticket analytics, SLA performance, and team productivity insights"
      userName="Ahmed Khalil"
      userRole="Senior Support Lead"
      workspaceLabel={supportConfig.workspaceLabel}
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {REPORT_METRICS.map(m => (
            <div key={m.label} className="bg-background-50 rounded-xl border border-background-200/50 p-4">
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${
                m.color === 'primary' ? 'bg-primary-100 text-primary-600' : m.color === 'emerald' ? 'bg-emerald-100 text-emerald-600' : 'bg-accent-100 text-accent-600'
              }`}>
                <AppIcon className={`${m.icon} text-xs`}></AppIcon>
              </span>
              <p className="text-xl font-heading font-semibold text-foreground-900">{m.value}</p>
              <p className="text-[10px] text-foreground-400 mt-1">{m.label}</p>
              <p className={`text-[10px] font-medium mt-0.5 ${m.trend.startsWith('+') ? 'text-emerald-600' : 'text-emerald-600'}`}>{m.trend}</p>
            </div>
          ))}
        </div>

        {/* Weekly Trend Chart */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 md:p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Weekly Ticket Activity</h3>
          <div className="flex items-center gap-4 text-[10px] text-foreground-400 mb-3">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary-400"></span> Created</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Resolved</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400"></span> Escalated</span>
          </div>
          <div className="flex items-end gap-2 md:gap-4 h-[160px]">
            {WEEKLY_TREND.map(d => {
              const maxVal = 35;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <div className="flex items-end gap-[2px] w-full max-w-[56px]" style={{ height: `${(Math.max(d.created, d.resolved) / maxVal) * 140}px` }}>
                    <div className="flex-1 bg-primary-400 rounded-t-[2px]" style={{ height: `${(d.created / maxVal) * 140}px` }}></div>
                    <div className="flex-1 bg-emerald-500 rounded-t-[2px]" style={{ height: `${(d.resolved / maxVal) * 140}px` }}></div>
                  </div>
                  {d.escalated > 0 && (
                    <div className="w-full max-w-[56px] flex justify-center">
                      <div className="w-2 h-2 rounded-full bg-red-400"></div>
                    </div>
                  )}
                  <span className="text-[9px] text-foreground-400 mt-1">{d.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Team Performance Table */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-background-100">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Team Performance (7 Days)</h3>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-background-100">
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Agent</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Tickets Handled</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Resolved</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Avg Response</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">SLA Met</th>
                <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">CSAT</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Ahmed Khalil', handled: 47, resolved: 38, response: '22m', sla: '96%', csat: '4.8' },
                { name: 'Layla Moussa', handled: 52, resolved: 44, response: '18m', sla: '98%', csat: '4.9' },
                { name: 'David Osei', handled: 38, resolved: 31, response: '35m', sla: '91%', csat: '4.5' },
                { name: 'Nadia Hussain', handled: 31, resolved: 27, response: '28m', sla: '94%', csat: '4.7' },
              ].map(agent => (
                <tr key={agent.name} className="border-b border-background-50 hover:bg-background-50/60 transition-smooth">
                  <td className="px-4 py-2.5 text-foreground-800 font-medium text-[11px]">{agent.name}</td>
                  <td className="px-4 py-2.5 text-foreground-700 text-[11px]">{agent.handled}</td>
                  <td className="px-4 py-2.5 text-foreground-700 text-[11px]">{agent.resolved}</td>
                  <td className="px-4 py-2.5 text-foreground-700 text-[11px]">{agent.response}</td>
                  <td className="px-4 py-2.5"><span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{agent.sla}</span></td>
                  <td className="px-4 py-2.5 text-foreground-700 text-[11px]">{agent.csat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </WorkspaceShell>
  );
}