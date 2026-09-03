import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

interface ReportSection {
  id: string;
  title: string;
  description: string;
  items: ReportItem[];
}

interface ReportItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  lastGenerated: string;
  status: 'ready' | 'pending' | 'generating';
  format: string[];
  recipient?: string;
}

const REPORT_SECTIONS: ReportSection[] = [
  {
    id: 'curriculum',
    title: 'Curriculum Health',
    description: 'Overview of all programmes, module completion rates, and content quality.',
    items: [
      { id: 'r-prog-summary', name: 'Programme Summary Report', description: 'All active programmes, versions, standards, and approval status.', icon: 'ri-stack-line', lastGenerated: '10 Jun 2026', status: 'ready', format: ['PDF', 'Excel'] },
      { id: 'r-module-completion', name: 'Module Completion Rates', description: 'Per-module learner progress across all cohorts.', icon: 'ri-layout-4-line', lastGenerated: '09 Jun 2026', status: 'ready', format: ['PDF', 'Excel', 'CSV'] },
      { id: 'r-ksb-coverage', name: 'KSB Coverage Report', description: 'Coverage analysis of all Knowledge, Skills and Behaviours across modules.', icon: 'ri-bar-chart-2-line', lastGenerated: '08 Jun 2026', status: 'ready', format: ['PDF'] },
      { id: 'r-version-control', name: 'Version Change Log', description: 'All programme version changes with diff highlights and approval dates.', icon: 'ri-git-branch-line', lastGenerated: '05 Jun 2026', status: 'ready', format: ['PDF'] },
    ],
  },
  {
    id: 'assessment',
    title: 'Assessment & Evidence',
    description: 'Quiz results, assignment scores, evidence quality metrics.',
    items: [
      { id: 'r-quiz-results', name: 'Quiz Results Summary', description: 'Aggregate quiz pass rates by module, cohort, and programme.', icon: 'ri-questionnaire-line', lastGenerated: '11 Jun 2026', status: 'ready', format: ['PDF', 'Excel'] },
      { id: 'r-assignment-grades', name: 'Assignment Grade Distribution', description: 'Distribution of assignment grades across all cohorts.', icon: 'ri-edit-line', lastGenerated: '10 Jun 2026', status: 'ready', format: ['PDF', 'Excel'] },
      { id: 'r-checkpoint', name: 'Checkpoint Assessment Results', description: 'Checkpoint completion rates and pass/fail analysis per module.', icon: 'ri-check-double-line', lastGenerated: '06 Jun 2026', status: 'ready', format: ['PDF', 'Excel'] },
    ],
  },
  {
    id: 'quality',
    title: 'Curriculum Quality',
    description: 'QA findings, self-assessment evidence, and Ofsted readiness indicators.',
    items: [
      { id: 'r-qa-findings', name: 'Curriculum QA Findings', description: 'All QA findings with severity, action owners and resolution status.', icon: 'ri-shield-check-line', lastGenerated: '09 Jun 2026', status: 'ready', format: ['PDF'] },
      { id: 'r-sar-evidence', name: 'SAR/QIP Evidence Pack', description: 'Curriculum quality evidence for Self-Assessment Review and Quality Improvement Plan.', icon: 'ri-file-text-line', lastGenerated: '01 Jun 2026', status: 'ready', format: ['PDF'] },
      { id: 'r-ofsted', name: 'Ofsted Inspection Pack', description: 'Curriculum intent, implementation and impact evidence pack.', icon: 'ri-government-line', lastGenerated: '01 May 2026', status: 'ready', format: ['PDF'] },
    ],
  },
  {
    id: 'delivery',
    title: 'Delivery & Engagement',
    description: 'Learner engagement with content, session attendance, and OTJH hours.',
    items: [
      { id: 'r-attendance-by-module', name: 'Attendance by Module', description: 'Per-module attendance rates across cohorts and delivery modes.', icon: 'ri-calendar-check-line', lastGenerated: '11 Jun 2026', status: 'ready', format: ['PDF', 'Excel'] },
      { id: 'r-otjh-tracking', name: 'OTJH Tracking Report', description: 'Off-the-job hours logged, target vs. actual across all active learners.', icon: 'ri-time-line', lastGenerated: '10 Jun 2026', status: 'ready', format: ['PDF', 'Excel'] },
      { id: 'r-learner-engagement', name: 'Learner Engagement Score', description: 'Composite engagement metrics: logins, evidence submissions, quiz attempts.', icon: 'ri-heart-line', lastGenerated: '09 Jun 2026', status: 'ready', format: ['PDF'] },
    ],
  },
];

const RECIPIENTS = [
  'CEO — Dr. Karen Ashby',
  'Deputy Principal — Mark Evans',
  'Quality & Standards Director — Louise Price',
  'Head of Apprenticeships — James Cooper',
  'Board of Governors',
  'Ofsted Lead Inspector',
];

export default function CurriculumReportsPage() {
  const [generating, setGenerating] = useState<string | null>(null);
  const [sendReportId, setSendReportId] = useState<string | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('PDF');
  const [sendNote, setSendNote] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'info'; text: string } | null>(null);

  const handleGenerate = (item: ReportItem) => {
    setGenerating(item.id);
    setTimeout(() => {
      setGenerating(null);
      setNotification({ type: 'success', text: `"${item.name}" generated successfully — ready to download.` });
      setTimeout(() => setNotification(null), 4000);
    }, 1600);
  };

  const handleSend = () => {
    const section = REPORT_SECTIONS.flatMap(s => s.items).find(i => i.id === sendReportId);
    if (!section || !selectedRecipient) return;
    setSendReportId(null);
    setNotification({ type: 'info', text: `"${section.name}" sent to ${selectedRecipient} as ${selectedFormat}.` });
    setSelectedRecipient('');
    setSendNote('');
    setTimeout(() => setNotification(null), 5000);
  };

  const statusBadge = (s: ReportItem['status'], id: string) => {
    if (generating === id) return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">Generating...</span>;
    if (s === 'ready') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Ready</span>;
    if (s === 'pending') return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background-200 text-foreground-400">Pending</span>;
    return null;
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Curriculum Reports"
      pageSubtitle="Generate, review and share curriculum reports with leadership and stakeholders"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full bg-background-100 p-4 sm:p-5 lg:p-6 space-y-4">

        {/* Notification */}
        {notification && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-medium border ${notification.type === 'success' ? 'bg-emerald-50 border-emerald-200/60 text-emerald-700' : 'bg-primary-50 border-primary-200/60 text-primary-700'}`}>
            <AppIcon className={`${notification.type === 'success' ? 'ri-checkbox-circle-line' : 'ri-mail-send-line'} text-base`}></AppIcon>
            {notification.text}
          </div>
        )}

        {/* Quick Send to Leadership */}
        <div className="bg-accent-50 border border-accent-200/60 rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-accent-100 rounded-xl flex items-center justify-center shrink-0">
              <AppIcon className="ri-send-plane-line text-accent-700 text-base"></AppIcon>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-0.5">Send to Leadership / CEO</h3>
              <p className="text-[12px] text-foreground-500 mb-3">
                Select any report below and use the <strong>Send</strong> button to deliver it directly to senior leadership, the CEO, or the Board of Governors. Reports can be sent as PDF or Excel.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-foreground-400">Quick recipients:</span>
                {RECIPIENTS.slice(0, 3).map(r => (
                  <span key={r} className="text-[10px] px-2.5 py-1 bg-accent-100 text-accent-700 rounded-full font-medium">{r}</span>
                ))}
                <span className="text-[10px] px-2.5 py-1 bg-background-100 text-foreground-500 rounded-full">+{RECIPIENTS.length - 3} more</span>
              </div>
            </div>
          </div>
        </div>

        {/* Report Sections */}
        {REPORT_SECTIONS.map(section => (
          <div key={section.id} className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground-200/60">
              <h2 className="text-sm font-heading font-semibold text-foreground-900">{section.title}</h2>
              <p className="text-[11px] text-foreground-400 mt-0.5">{section.description}</p>
            </div>
            <div className="divide-y divide-background-200/30">
              {section.items.map(item => (
                <div key={item.id} className="p-4 flex items-start gap-4 hover:bg-background-100/40 transition-smooth">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary-700 shadow-sm">
                    <AppIcon className={`${item.icon} text-base`}></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <p className="text-[13px] font-medium text-foreground-900">{item.name}</p>
                      {statusBadge(item.status, item.id)}
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{item.description}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] text-foreground-400">Last generated: {item.lastGenerated}</span>
                      <span className="text-foreground-300">·</span>
                      <span className="text-[10px] text-foreground-400">Formats: {item.format.join(', ')}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => handleGenerate(item)}
                      disabled={generating === item.id}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-background-200 bg-background-100 px-3 py-1.5 text-[11px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <AppIcon className="ri-refresh-line text-[13px]"></AppIcon>
                      {generating === item.id ? 'Generating...' : 'Generate'}
                    </button>
                    <button
                      onClick={() => { setSendReportId(item.id); setSelectedFormat(item.format[0]); }}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      <AppIcon className="ri-send-plane-line text-[13px]"></AppIcon>
                      Send
                    </button>
                    <button type="button" title="Download report" aria-label="Download report" className="flex h-8 w-8 items-center justify-center rounded-lg border border-background-200 bg-background-100 text-foreground-500 hover:bg-background-200 transition-smooth cursor-pointer">
                      <AppIcon className="ri-download-line text-sm"></AppIcon>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Send Report Modal */}
      {sendReportId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-md shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Send Report</h3>
              <button onClick={() => setSendReportId(null)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-close-line text-foreground-500 text-sm"></AppIcon>
              </button>
            </div>

            {(() => {
              const report = REPORT_SECTIONS.flatMap(s => s.items).find(i => i.id === sendReportId);
              if (!report) return null;
              return (
                <div className="space-y-4">
                  <div className="p-3 bg-background-100/60 rounded-xl border border-foreground-200/60">
                    <p className="text-[12px] font-medium text-foreground-800">{report.name}</p>
                    <p className="text-[10px] text-foreground-400 mt-0.5">{report.description}</p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1.5">Send to</label>
                    <select
                      value={selectedRecipient}
                      onChange={e => setSelectedRecipient(e.target.value)}
                      className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 outline-none focus:border-primary-400 transition-smooth cursor-pointer"
                    >
                      <option value="">Select recipient...</option>
                      {RECIPIENTS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1.5">Format</label>
                    <div className="flex items-center gap-2">
                      {report.format.map(f => (
                        <button
                          key={f}
                          onClick={() => setSelectedFormat(f)}
                          aria-pressed={selectedFormat === f}
                          className={`px-4 py-2 rounded-xl text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${selectedFormat === f ? 'bg-primary-500 text-white' : 'bg-background-100 border border-background-200 text-foreground-600 hover:bg-background-200'}`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-1.5">Note (optional)</label>
                    <textarea
                      value={sendNote}
                      onChange={e => setSendNote(e.target.value)}
                      rows={2}
                      placeholder="Add a brief note for the recipient..."
                      className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[12px] text-foreground-700 placeholder:text-foreground-300 outline-none focus:border-primary-400 transition-smooth resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSend}
                      disabled={!selectedRecipient}
                      className="flex-1 px-4 py-2.5 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <AppIcon className="ri-send-plane-line mr-1.5"></AppIcon>
                      Send Report
                    </button>
                    <button
                      onClick={() => setSendReportId(null)}
                      className="px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
