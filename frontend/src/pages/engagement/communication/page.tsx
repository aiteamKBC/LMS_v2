import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface CommunicationItem {
  id: string;
  type: 'email' | 'call' | 'whatsapp' | 'sms' | 'teams';
  from: string;
  fromRole: string;
  to: string;
  toRole: string;
  subject: string;
  preview: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read' | 'replied' | 'failed';
  priority: 'normal' | 'high' | 'urgent';
  category: string;
}

const COMMUNICATIONS: CommunicationItem[] = [
  { id: 'com-01', type: 'email', from: 'Sarah Chen', fromRole: 'Coach', to: 'James Okonkwo', toRole: 'Learner', subject: 'Attendance Intervention Required', preview: 'Your attendance has dropped below 70%. We need to discuss a catch-up plan...', timestamp: 'Today, 09:30', status: 'read', priority: 'urgent', category: 'Attendance' },
  { id: 'com-02', type: 'call', from: 'Med Maher', fromRole: 'Coach', to: 'Aisha Patel', toRole: 'Learner', subject: 'Catch-up session scheduling', preview: 'Phone call: 12 minutes. Discussed catch-up plan for missed Taxation Module...', timestamp: 'Today, 08:15', status: 'replied', priority: 'high', category: 'Catch-up' },
  { id: 'com-03', type: 'whatsapp', from: 'Tom Harrington', fromRole: 'Engagement Manager', to: 'Daniel Walsh', toRole: 'Learner', subject: 'Unreported absence follow-up', preview: 'Hi Daniel, you missed the Business Communication session yesterday...', timestamp: 'Yesterday, 16:45', status: 'delivered', priority: 'high', category: 'Absence' },
  { id: 'com-04', type: 'email', from: 'Priya Patel', fromRole: 'Ambassador', to: 'Marketing Club', toRole: 'Group', subject: 'Monthly showcase invite', preview: 'Join us this Friday for the Marketing Club Monthly Showcase at 13:00...', timestamp: 'Yesterday, 11:00', status: 'read', priority: 'normal', category: 'Clubs' },
  { id: 'com-05', type: 'sms', from: 'System', fromRole: 'Automated', to: 'Sophie Williams', toRole: 'Learner', subject: 'Session reminder', preview: 'Reminder: Marketing Environment session tomorrow at 15:00 via Teams...', timestamp: 'Yesterday, 18:00', status: 'delivered', priority: 'normal', category: 'Reminder' },
  { id: 'com-06', type: 'teams', from: 'James Harrington', fromRole: 'Coach', to: 'Maya Kapoor', toRole: 'Learner', subject: 'HR Policy Workshop rescheduled', preview: 'The HR Policy Workshop has been rescheduled to 14 June at 10:00...', timestamp: '9 Jun, 14:30', status: 'read', priority: 'high', category: 'Reschedule' },
  { id: 'com-07', type: 'email', from: 'Rebecca Okonkwo', fromRole: 'Ambassador', to: 'All Members', toRole: 'Group', subject: 'Social Media Strategy Workshop', preview: 'Great discussion on customer personas this week! I have shared a template...', timestamp: '8 Jun, 10:00', status: 'read', priority: 'normal', category: 'Workshop' },
  { id: 'com-08', type: 'call', from: 'Sarah Chen', fromRole: 'Coach', to: 'Unilever HR', toRole: 'Employer', subject: 'Employer check-in', preview: 'Phone call: 18 minutes. Discussed James workplace support and OTJH tracking...', timestamp: '7 Jun, 11:00', status: 'replied', priority: 'normal', category: 'Employer' },
  { id: 'com-09', type: 'whatsapp', from: 'Med Maher', fromRole: 'Coach', to: 'Oliver Grant', toRole: 'Learner', subject: 'Quick check-in', preview: 'Hey Oliver, how are you doing with the Project Planning module? Need any help?', timestamp: '7 Jun, 09:30', status: 'replied', priority: 'normal', category: 'Check-in' },
  { id: 'com-10', type: 'email', from: 'System', fromRole: 'Automated', to: 'All Learners', toRole: 'Group', subject: 'Monthly engagement report', preview: 'Your monthly engagement score is 72%. Here is a breakdown of your activity...', timestamp: '6 Jun, 08:00', status: 'read', priority: 'normal', category: 'Report' },
];

const typeConfig: Record<string, { icon: string; bg: string; text: string }> = {
  email: { icon: 'ri-mail-line', bg: 'bg-primary-100', text: 'text-primary-700' },
  call: { icon: 'ri-phone-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  whatsapp: { icon: 'ri-whatsapp-line', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  sms: { icon: 'ri-message-3-line', bg: 'bg-accent-100', text: 'text-accent-700' },
  teams: { icon: 'ri-team-line', bg: 'bg-secondary-100', text: 'text-secondary-700' },
};

export default function CommunicationPage() {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const filtered = COMMUNICATIONS.filter(c => {
    const matchType = typeFilter === 'all' || c.type === typeFilter;
    const matchSearch = c.subject.toLowerCase().includes(search.toLowerCase()) || c.from.toLowerCase().includes(search.toLowerCase()) || c.to.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Communication Centre" pageSubtitle="Central hub for all learner, employer, and staff communications"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Communication Centre"
          description={`${COMMUNICATIONS.length} communications in the last 7 days. ${COMMUNICATIONS.filter(c => c.priority === 'urgent').length} urgent items requiring attention. All channels: email, call, WhatsApp, SMS, Teams.`}
          icon="ri-message-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20communication%20centre%20unified%20inbox%20modern%20workspace%20warm%20lighting&width=400&height=160&seq=communication-01&orientation=landscape"
          imageAlt="Communication Centre"
          stats={[{ label: 'Total', value: String(COMMUNICATIONS.length) }, { label: 'Urgent', value: String(COMMUNICATIONS.filter(c => c.priority === 'urgent').length), variant: 'danger' }, { label: 'Replied', value: String(COMMUNICATIONS.filter(c => c.status === 'replied').length) }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/call-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-phone-line text-sm"></i> Call Logs
          </button>
          <button onClick={() => navigate('/engagement/whatsapp-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-whatsapp-line text-sm"></i> WhatsApp Logs
          </button>
          <button onClick={() => navigate('/engagement/email-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-mail-line text-sm"></i> Email Logs
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search communications..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'email', 'call', 'whatsapp', 'sms', 'teams'].map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className={`${t === 'all' ? 'ri-list-check' : typeConfig[t]?.icon || 'ri-message-line'} text-sm`}></i>
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Communication List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">Recent Communications</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} items</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(com => {
              const cfg = typeConfig[com.type] || { icon: 'ri-message-line', bg: 'bg-background-100', text: 'text-foreground-500' };
              return (
                <div key={com.id} className={`p-4 flex items-start gap-4 ${com.priority === 'urgent' ? 'bg-red-50/20' : com.priority === 'high' ? 'bg-amber-50/20' : ''}`}>
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.text}`}>
                    <i className={`${cfg.icon} text-sm`}></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-[12px] font-semibold text-foreground-900">{com.subject}</span>
                      <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{com.category}</span>
                      <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${com.priority === 'urgent' ? 'bg-red-100 text-red-700' : com.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{com.priority}</span>
                    </div>
                    <p className="text-[11px] text-foreground-500 mb-2">{com.preview}</p>
                    <div className="flex items-center gap-3 text-[10px] text-foreground-400">
                      <span>From: <strong className="text-foreground-600">{com.from}</strong> ({com.fromRole})</span>
                      <span>To: <strong className="text-foreground-600">{com.to}</strong> ({com.toRole})</span>
                      <span>{com.timestamp}</span>
                      <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${com.status === 'read' || com.status === 'replied' ? 'bg-emerald-100 text-emerald-700' : com.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'}`}>{com.status}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-eye-line mr-1"></i> View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}