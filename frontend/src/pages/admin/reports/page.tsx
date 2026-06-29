import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const REPORTS_DATA = [
  { id: 'r1', name: 'Learner Progress Summary', type: 'Dashboard', category: 'Learner', frequency: 'Real-time', lastRun: '10 Jun 2026, 10:00', runs: 45, status: 'active' as const, trend: [62, 65, 68, 71, 74, 78, 80, 82, 85, 88] },
  { id: 'r2', name: 'Cohort Performance Report', type: 'Analytical', category: 'Cohort', frequency: 'Weekly', lastRun: '9 Jun 2026, 08:00', runs: 24, status: 'active' as const, trend: [72, 70, 74, 76, 75, 78, 80, 79, 82, 85] },
  { id: 'r3', name: 'Attendance Risk Analysis', type: 'Analytical', category: 'Attendance', frequency: 'Daily', lastRun: '10 Jun 2026, 06:00', runs: 124, status: 'active' as const, trend: [88, 86, 90, 87, 85, 89, 91, 90, 88, 92] },
  { id: 'r4', name: 'OTJH Compliance Report', type: 'Compliance', category: 'OTJH', frequency: 'Monthly', lastRun: '1 Jun 2026, 00:00', runs: 6, status: 'active' as const, trend: [76, 78, 80, 81, 82, 84, 85, 86, 87, 89] },
  { id: 'r5', name: 'KSB Completion Tracker', type: 'Dashboard', category: 'KSB', frequency: 'Real-time', lastRun: '10 Jun 2026, 10:00', runs: 67, status: 'active' as const, trend: [55, 58, 62, 65, 68, 71, 74, 76, 80, 83] },
  { id: 'r6', name: 'Evidence QA Summary', type: 'Analytical', category: 'QA', frequency: 'Weekly', lastRun: '8 Jun 2026, 09:00', runs: 24, status: 'active' as const, trend: [90, 88, 92, 91, 89, 93, 94, 92, 95, 96] },
  { id: 'r7', name: 'Employer Engagement Report', type: 'Analytical', category: 'Employer', frequency: 'Monthly', lastRun: '1 Jun 2026, 00:00', runs: 6, status: 'active' as const, trend: [70, 72, 68, 74, 76, 75, 78, 80, 79, 82] },
  { id: 'r8', name: 'Financial Overview', type: 'Financial', category: 'Finance', frequency: 'Monthly', lastRun: '1 Jun 2026, 00:00', runs: 6, status: 'active' as const, trend: [85, 87, 86, 88, 90, 89, 91, 92, 94, 95] },
  { id: 'r9', name: 'ILR Data Export', type: 'Compliance', category: 'Compliance', frequency: 'Monthly', lastRun: '5 Jun 2026, 00:00', runs: 6, status: 'active' as const, trend: [100, 100, 98, 100, 100, 99, 100, 100, 100, 100] },
  { id: 'r10', name: 'Ofsted Evidence Pack', type: 'Compliance', category: 'Compliance', frequency: 'Quarterly', lastRun: '1 Apr 2026, 00:00', runs: 2, status: 'active' as const, trend: [78, 80, 82, 83, 85, 86, 87, 88, 90, 92] },
  { id: 'r11', name: 'Coach Workload Report', type: 'Analytical', category: 'Coach', frequency: 'Monthly', lastRun: '1 Jun 2026, 00:00', runs: 6, status: 'active' as const, trend: [82, 80, 84, 86, 85, 88, 87, 89, 90, 92] },
  { id: 'r12', name: 'Tutor SLA Performance', type: 'Analytical', category: 'Tutor', frequency: 'Weekly', lastRun: '9 Jun 2026, 08:00', runs: 24, status: 'active' as const, trend: [88, 90, 87, 91, 92, 90, 93, 94, 93, 95] },
];

const ANALYTICS_SUMMARY = [
  { label: 'Avg Learner Progress', value: '74%', change: '+6%', positive: true, icon: 'ri-line-chart-line' },
  { label: 'Attendance Rate', value: '89%', change: '+2%', positive: true, icon: 'ri-calendar-check-line' },
  { label: 'OTJH On-Track', value: '82%', change: '-1%', positive: false, icon: 'ri-time-line' },
  { label: 'KSB Completion', value: '71%', change: '+8%', positive: true, icon: 'ri-bar-chart-2-line' },
  { label: 'Evidence Validated', value: '94%', change: '+3%', positive: true, icon: 'ri-shield-check-line' },
  { label: 'Employer Engagement', value: '76%', change: '+4%', positive: true, icon: 'ri-building-2-line' },
];

const MONTHLY_DATA = [65, 68, 72, 69, 74, 78, 75, 80, 82, 79, 84, 87];
const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

export default function AdminReportsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'reports' | 'analytics'>('analytics');

  const activeCount = REPORTS_DATA.filter(r => r.status === 'active').length;
  const totalRuns = REPORTS_DATA.reduce((a, b) => a + b.runs, 0);

  const filtered = REPORTS_DATA.filter(r => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || r.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const report = selectedReport ? REPORTS_DATA.find(r => r.id === selectedReport) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Reports & Analytics" pageSubtitle="Report builder, data analytics, and scheduled exports" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-bar-chart-box-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Reports & Analytics Centre</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{REPORTS_DATA.length} reports</strong> — {activeCount} active. {totalRuns} total runs. Real-time analytics across all programme metrics.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{REPORTS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Reports</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalRuns}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Runs</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">89%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Attendance</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit">
          <button onClick={() => setActiveTab('analytics')} className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${activeTab === 'analytics' ? 'bg-white text-foreground-900' : 'text-foreground-500 hover:text-foreground-700'}`}>
            <i className="ri-pie-chart-line mr-2"></i>Analytics
          </button>
          <button onClick={() => setActiveTab('reports')} className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${activeTab === 'reports' ? 'bg-white text-foreground-900' : 'text-foreground-500 hover:text-foreground-700'}`}>
            <i className="ri-bar-chart-box-line mr-2"></i>Report Builder
          </button>
        </div>

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {ANALYTICS_SUMMARY.map(metric => (
                <div key={metric.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                      <i className={`${metric.icon} text-primary-600 text-sm`}></i>
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${metric.positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{metric.change}</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground-900">{metric.value}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">{metric.label}</p>
                </div>
              ))}
            </div>

            {/* Main Chart */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Learner Progress — 12 Month Trend</h3>
                  <p className="text-[12px] text-foreground-400">Average programme completion % across all active cohorts</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-foreground-500"><span className="w-3 h-1.5 rounded-full bg-primary-500"></span> Progress</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-foreground-500"><span className="w-3 h-1.5 rounded-full bg-accent-500"></span> Target</span>
                </div>
              </div>
              <div className="flex items-end gap-3 h-40 px-2 mb-2">
                {MONTHLY_DATA.map((val, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="relative w-full flex flex-col justify-end" style={{ height: '100%' }}>
                      <div className="absolute top-0 left-0 right-0 border-t border-dashed border-accent-300/50" style={{ top: `${100 - 80}%` }}></div>
                      <div
                        className="w-full bg-gradient-to-t from-primary-500 to-primary-400 rounded-t-md"
                        style={{ height: `${val}%` }}
                      ></div>
                    </div>
                    <span className="text-[9px] text-foreground-400">{MONTHS[i]}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[11px] text-foreground-400 px-2">
                <span>Jul 2025</span>
                <span>Peak: 87% (Jun 2026)</span>
                <span>Jun 2026</span>
              </div>
            </div>

            {/* Multi Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Cohort Performance */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Cohort Performance</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Cohort A — Business Admin L3', pct: 78, color: 'bg-primary-500' },
                    { label: 'Cohort B — Digital Marketing L3', pct: 45, color: 'bg-primary-400' },
                    { label: 'Cohort C — Business Admin L3', pct: 12, color: 'bg-primary-300' },
                    { label: 'Cohort D — Software Dev L4', pct: 35, color: 'bg-accent-500' },
                    { label: 'Cohort E — Project Manager L4', pct: 22, color: 'bg-accent-400' },
                    { label: 'Cohort F — Data Analyst L4', pct: 40, color: 'bg-secondary-500' },
                  ].map(c => (
                    <div key={c.label}>
                      <div className="flex items-center justify-between text-[11px] mb-0.5">
                        <span className="text-foreground-600 truncate">{c.label.split(' — ')[0]}</span>
                        <span className="font-semibold text-foreground-900 ml-2">{c.pct}%</span>
                      </div>
                      <div className="h-2 bg-background-200 rounded-full overflow-hidden">
                        <div className={`h-full ${c.color} rounded-full transition-smooth`} style={{ width: `${c.pct}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attendance Distribution */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Attendance Distribution</h3>
                <div className="flex items-end gap-2 h-28 mb-3">
                  {[
                    { label: '&lt;75%', value: 5, color: 'bg-red-500' },
                    { label: '75–80%', value: 8, color: 'bg-accent-500' },
                    { label: '81–85%', value: 12, color: 'bg-accent-400' },
                    { label: '86–90%', value: 18, color: 'bg-emerald-400' },
                    { label: '91–95%', value: 10, color: 'bg-emerald-500' },
                    { label: '&gt;95%', value: 6, color: 'bg-emerald-600' },
                  ].map((bar, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`w-full ${bar.color} rounded-t-sm`} style={{ height: `${(bar.value / 18) * 100}%` }}></div>
                      <span className="text-[8px] text-foreground-400 text-center" dangerouslySetInnerHTML={{ __html: bar.label }}></span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-[10px] text-foreground-500"><span className="w-2 h-2 rounded-full bg-red-500"></span> At Risk</span>
                  <span className="flex items-center gap-1 text-[10px] text-foreground-500"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> On Track</span>
                </div>
              </div>

              {/* KSB Coverage */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">KSB Coverage by Type</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Knowledge', validated: 78, pending: 12, total: 100 },
                    { label: 'Skills', validated: 64, pending: 18, total: 100 },
                    { label: 'Behaviours', validated: 58, pending: 22, total: 100 },
                  ].map(ksb => (
                    <div key={ksb.label}>
                      <div className="flex items-center justify-between text-[12px] mb-1">
                        <span className="font-medium text-foreground-700">{ksb.label}</span>
                        <span className="text-foreground-500">{ksb.validated}%</span>
                      </div>
                      <div className="h-2.5 bg-background-200 rounded-full overflow-hidden flex">
                        <div className="h-full bg-primary-500" style={{ width: `${ksb.validated}%` }}></div>
                        <div className="h-full bg-primary-200" style={{ width: `${ksb.pending}%` }}></div>
                      </div>
                      <div className="flex gap-3 mt-0.5 text-[10px] text-foreground-400">
                        <span>{ksb.validated} validated</span>
                        <span>{ksb.pending} pending</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 pt-3 border-t border-foreground-200/60">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-xl font-bold text-foreground-900">52</p>
                      <p className="text-[10px] text-foreground-400">Total Learners</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-primary-600">67%</p>
                      <p className="text-[10px] text-foreground-400">Avg Coverage</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-emerald-600">14</p>
                      <p className="text-[10px] text-foreground-400">Gateway Ready</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Performance Table */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-foreground-400/50">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Report Metrics — Live Snapshot</h3>
                <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-download-line mr-1"></i> Export All
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-foreground-400/50 bg-background-100/50">
                      <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Report Name</th>
                      <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Category</th>
                      <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Frequency</th>
                      <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Last Metric</th>
                      <th className="text-left py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Trend</th>
                      <th className="text-right py-3 px-4 text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">Runs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {REPORTS_DATA.map(r => {
                      const lastVal = r.trend[r.trend.length - 1];
                      const prevVal = r.trend[r.trend.length - 2];
                      const isUp = lastVal >= prevVal;
                      return (
                        <tr key={r.id} className="border-b border-background-100 hover:bg-background-50 transition-smooth cursor-pointer" onClick={() => setSelectedReport(r.id)}>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground-900">{r.name}</span>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.type === 'Dashboard' ? 'bg-primary-50 text-primary-700' : r.type === 'Analytical' ? 'bg-secondary-50 text-secondary-700' : 'bg-accent-50 text-accent-700'}`}>{r.type}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-[13px] text-foreground-500">{r.category}</td>
                          <td className="py-3 px-4 text-[13px] text-foreground-500">{r.frequency}</td>
                          <td className="py-3 px-4">
                            <span className="text-[13px] font-semibold text-foreground-900">{lastVal}%</span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex items-end gap-0.5 h-6">
                                {r.trend.slice(-6).map((v, i) => (
                                  <div key={i} className="w-1.5 bg-primary-400 rounded-t-sm" style={{ height: `${(v / 100) * 24}px` }}></div>
                                ))}
                              </div>
                              <span className={`text-[10px] font-semibold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
                                <i className={`${isUp ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}`}></i> {Math.abs(lastVal - prevVal)}pp
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-[13px] text-foreground-500">{r.runs}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-5">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
              <div className="relative flex-1 w-full lg:w-auto">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
                <input type="text" placeholder="Search reports..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
              </div>
              <div className="flex items-center gap-2">
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
                  <option value="all">All Categories</option>
                  <option value="Learner">Learner</option>
                  <option value="Cohort">Cohort</option>
                  <option value="Attendance">Attendance</option>
                  <option value="OTJH">OTJH</option>
                  <option value="KSB">KSB</option>
                  <option value="QA">QA</option>
                  <option value="Employer">Employer</option>
                  <option value="Finance">Finance</option>
                  <option value="Compliance">Compliance</option>
                </select>
                <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-add-line mr-1.5"></i> New Report
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-3">
                {filtered.map(r => (
                  <div key={r.id} onClick={() => setSelectedReport(r.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedReport === r.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                    <div className="w-10 h-10 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                      <i className="ri-bar-chart-box-line text-secondary-600 text-sm"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground-900">{r.name}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${r.type === 'Dashboard' ? 'bg-primary-50 text-primary-700 border-primary-200/50' : r.type === 'Analytical' ? 'bg-secondary-50 text-secondary-700 border-secondary-200/50' : 'bg-accent-50 text-accent-700 border-accent-200/50'}`}>{r.type}</span>
                        <span className="bg-emerald-50 text-emerald-700 border-emerald-200/50 text-[10px] font-semibold px-2 py-0.5 rounded-full border">{r.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{r.category} · {r.frequency} · Last: {r.lastRun}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-end gap-0.5 h-6">
                        {r.trend.slice(-6).map((v, i) => (
                          <div key={i} className="w-1.5 bg-primary-400 rounded-t-sm" style={{ height: `${(v / 100) * 24}px` }}></div>
                        ))}
                      </div>
                      <span className="text-[12px] text-foreground-500">{r.runs} runs</span>
                    </div>
                    <i className={`ri-arrow-right-s-line text-foreground-300 ${selectedReport === r.id ? 'text-primary-500' : ''}`}></i>
                  </div>
                ))}
              </div>

              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
                {report ? (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-heading font-semibold text-foreground-900">{report.name}</h3>
                      <p className="text-[12px] text-foreground-500 mt-1">{report.type} · {report.category} · {report.frequency}</p>
                    </div>
                    <div className="flex items-end gap-1 h-20">
                      {report.trend.map((v, i) => (
                        <div key={i} className="flex-1 bg-gradient-to-t from-primary-500 to-primary-400 rounded-t-sm" style={{ height: `${v}%` }}></div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-background-100 rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-foreground-900">{report.runs}</p>
                        <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Runs</p>
                      </div>
                      <div className="bg-background-100 rounded-lg p-3 text-center">
                        <p className="text-xl font-bold text-primary-600">{report.trend[report.trend.length - 1]}%</p>
                        <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Latest</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Run Now</button>
                      <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Schedule</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                      <i className="ri-bar-chart-box-line text-foreground-300 text-xl"></i>
                    </div>
                    <p className="text-sm text-foreground-500">Select a report to view details</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}