import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';

const engagementNav = roleNavMap.engagement;

interface EmailLog {
  id: string;
  from: string;
  fromRole: string;
  to: string;
  toRole: string;
  subject: string;
  preview: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
  type: 'automated' | 'manual';
  category: string;
  attachments: number;
}

const EMAIL_LOGS: EmailLog[] = [
  { id: 'em-01', from: 'System', fromRole: 'Automated', to: 'All Learners', toRole: 'Group', subject: 'Weekly engagement reminder', preview: 'Your weekly engagement score is available. Check your dashboard for details...', timestamp: 'Today, 08:00', status: 'delivered', type: 'automated', category: 'Reminder', attachments: 0 },
  { id: 'em-02', from: 'Sarah Chen', fromRole: 'Coach', to: 'James Okonkwo', toRole: 'Learner', subject: 'Attendance intervention — action required', preview: 'Dear James, your attendance has dropped below 70%. Please contact your coach urgently...', timestamp: 'Today, 07:30', status: 'opened', type: 'manual', category: 'Attendance', attachments: 1 },
  { id: 'em-03', from: 'Tom Harrington', fromRole: 'Engagement Manager', to: 'Unilever HR', toRole: 'Employer', subject: 'Learner attendance update — James Okonkwo', preview: 'We wanted to inform you that James has missed several sessions recently. We are working on a support plan...', timestamp: 'Yesterday, 14:00', status: 'opened', type: 'manual', category: 'Employer', attachments: 1 },
  { id: 'em-04', from: 'System', fromRole: 'Automated', to: 'Daniel Walsh', toRole: 'Learner', subject: 'Absence report — unreported absence', preview: 'You have been marked absent for the Business Communication session on 9 June. Please report your absence...', timestamp: 'Yesterday, 10:00', status: 'delivered', type: 'automated', category: 'Absence', attachments: 0 },
  { id: 'em-05', from: 'Med Maher', fromRole: 'Coach', to: 'Aisha Patel', toRole: 'Learner', subject: 'Catch-up session confirmation', preview: 'Your catch-up session for the Taxation Module has been scheduled for 15 June at 14:00. Please confirm...', timestamp: 'Yesterday, 09:00', status: 'clicked', type: 'manual', category: 'Catch-up', attachments: 1 },
  { id: 'em-06', from: 'System', fromRole: 'Automated', to: 'Marketing Club', toRole: 'Group', subject: 'Monthly showcase invitation', preview: 'You are invited to the Marketing Club Monthly Showcase on Friday, 13 June at 13:00...', timestamp: '8 Jun, 16:00', status: 'clicked', type: 'automated', category: 'Clubs', attachments: 1 },
  { id: 'em-07', from: 'James Harrington', fromRole: 'Coach', to: 'Maya Kapoor', toRole: 'Learner', subject: 'Rescheduled session — HR Policy Workshop', preview: 'The HR Policy Workshop has been moved to 14 June at 10:00. Please update your calendar...', timestamp: '8 Jun, 11:00', status: 'opened', type: 'manual', category: 'Reschedule', attachments: 1 },
  { id: 'em-08', from: 'System', fromRole: 'Automated', to: 'All Members', toRole: 'Group', subject: 'Engagement points update', preview: 'You have earned 50 engagement points this week! Your total is now 340 points...', timestamp: '8 Jun, 08:00', status: 'delivered', type: 'automated', category: 'Points', attachments: 0 },
  { id: 'em-09', from: 'Tom Harrington', fromRole: 'Engagement Manager', to: 'Tesco Training Manager', toRole: 'Employer', subject: 'Employer escalation — attendance pattern', preview: 'We have noticed a concerning attendance pattern for multiple learners. Can we schedule a meeting...', timestamp: '7 Jun, 10:00', status: 'opened', type: 'manual', category: 'Escalation', attachments: 1 },
  { id: 'em-10', from: 'System', fromRole: 'Automated', to: 'Sophie Williams', toRole: 'Learner', subject: 'Congratulations — top club performer', preview: 'Congratulations! You are the top performer in the Marketing Club this month. Your reward voucher is attached...', timestamp: '7 Jun, 08:00', status: 'clicked', type: 'automated', category: 'Recognition', attachments: 1 },
];

const statusConfig: Record<string, { color: string; bg: string }> = {
  sent: { color: 'text-foreground-500', bg: 'bg-foreground-100' },
  delivered: { color: 'text-primary-700', bg: 'bg-primary-100' },
  opened: { color: 'text-emerald-700', bg: 'bg-emerald-100' },
  clicked: { color: 'text-accent-700', bg: 'bg-accent-100' },
  bounced: { color: 'text-red-700', bg: 'bg-red-100' },
  failed: { color: 'text-red-700', bg: 'bg-red-100' },
};

export default function EmailLogsPage() {
  const operator = useOperatorIdentity();
  const [typeFilter, setTypeFilter] = useState<'all' | 'automated' | 'manual'>('all');
  const [search, setSearch] = useState('');
  const filtered = EMAIL_LOGS.filter(e => {
    const matchType = typeFilter === 'all' || e.type === typeFilter;
    const matchSearch = e.subject.toLowerCase().includes(search.toLowerCase()) || e.from.toLowerCase().includes(search.toLowerCase()) || e.to.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });
  const openRate = Math.round((EMAIL_LOGS.filter(e => e.status === 'opened' || e.status === 'clicked').length / EMAIL_LOGS.length) * 100);
  const clickRate = Math.round((EMAIL_LOGS.filter(e => e.status === 'clicked').length / EMAIL_LOGS.length) * 100);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Email Logs" pageSubtitle="Search and review all email communications sent through the platform"
      userName={operator.name} userRole={operator.role}
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Email Communication Logs"
          description={`${EMAIL_LOGS.length} emails sent. Open rate: ${openRate}%, Click rate: ${clickRate}%. ${EMAIL_LOGS.filter(e => e.status === 'bounced' || e.status === 'failed').length} delivery failures. Automated and manual emails tracked.`}
          icon="ri-mail-line"
          imageUrl="https://readdy.ai/api/search-image?query=professional%20email%20communication%20inbox%20modern%20workspace%20warm%20lighting%20laptop%20screen&width=400&height=160&seq=email-logs-01&orientation=landscape"
          imageAlt="Email Logs"
          stats={[{ label: 'Sent', value: String(EMAIL_LOGS.length) }, { label: 'Open Rate', value: `${openRate}%` }, { label: 'Failures', value: String(EMAIL_LOGS.filter(e => e.status === 'bounced' || e.status === 'failed').length), variant: 'danger' }]}
        />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input type="text" placeholder="Search emails..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1">
            {(['all', 'automated', 'manual'] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <AppIcon className={`${t === 'automated' ? 'ri-robot-line' : t === 'manual' ? 'ri-user-line' : 'ri-list-check'} text-sm`}></AppIcon>
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Email List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">Email Records</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} emails</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(email => {
              const cfg = statusConfig[email.status] || { color: 'text-foreground-500', bg: 'bg-foreground-100' };
              return (
                <div key={email.id} className="p-4 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-mail-line text-sm"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[12px] font-semibold text-foreground-900">{email.subject}</span>
                      <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{email.category}</span>
                      <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${email.type === 'automated' ? 'bg-accent-100 text-accent-700' : 'bg-primary-100 text-primary-700'}`}>{email.type}</span>
                    </div>
                    <p className="text-[11px] text-foreground-500 mb-2">{email.preview}</p>
                    <div className="flex items-center gap-3 text-[10px] text-foreground-400">
                      <span>From: <strong className="text-foreground-600">{email.from}</strong> ({email.fromRole})</span>
                      <span>To: <strong className="text-foreground-600">{email.to}</strong> ({email.toRole})</span>
                      <span>{email.timestamp}</span>
                      <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{email.status}</span>
                      {email.attachments > 0 && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"><AppIcon className="ri-attachment-2 mr-0.5"></AppIcon>{email.attachments}</span>}
                    </div>
                  </div>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
                    <AppIcon className="ri-eye-line"></AppIcon> View
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}