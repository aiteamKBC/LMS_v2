import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface WhatsAppLog {
  id: string;
  sender: string;
  senderRole: string;
  recipient: string;
  recipientRole: string;
  message: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read' | 'replied';
  category: string;
  hasMedia: boolean;
}

const WHATSAPP_LOGS: WhatsAppLog[] = [
  { id: 'wa-01', sender: 'Med Maher', senderRole: 'Coach', recipient: 'James Okonkwo', recipientRole: 'Learner', message: 'Hi James, we need to talk about your recent absences. Can you give me a call today?', timestamp: 'Today, 08:30', status: 'read', category: 'Attendance', hasMedia: false },
  { id: 'wa-02', sender: 'Tom Harrington', senderRole: 'Engagement Manager', recipient: 'Daniel Walsh', recipientRole: 'Learner', message: 'Daniel, you missed the Business Communication session yesterday. Is everything okay? Please let me know.', timestamp: 'Yesterday, 16:45', status: 'delivered', category: 'Absence', hasMedia: false },
  { id: 'wa-03', sender: 'Sarah Chen', senderRole: 'Coach', recipient: 'Maya Kapoor', recipientRole: 'Learner', message: 'Great news! The HR Policy Workshop has been rescheduled to 14 June. Are you able to attend?', timestamp: 'Yesterday, 11:00', status: 'replied', category: 'Reschedule', hasMedia: false },
  { id: 'wa-04', sender: 'James Harrington', senderRole: 'Coach', recipient: 'Priya Sharma', recipientRole: 'Learner', message: 'Hi Priya, I noticed your engagement score has dropped. Let us schedule a quick check-in call.', timestamp: '8 Jun, 09:30', status: 'read', category: 'Check-in', hasMedia: false },
  { id: 'wa-05', sender: 'Med Maher', senderRole: 'Coach', recipient: 'Oliver Grant', recipientRole: 'Learner', message: 'Thanks for letting me know about the car breakdown. Hope you are doing okay. See you at the next session!', timestamp: '8 Jun, 08:00', status: 'replied', category: 'Absence', hasMedia: false },
  { id: 'wa-06', sender: 'Tom Harrington', senderRole: 'Engagement Manager', recipient: 'Sophie Williams', recipientRole: 'Learner', message: 'Hi Sophie, congratulations on being the top performer in the Marketing Club this month!', timestamp: '7 Jun, 14:00', status: 'read', category: 'Recognition', hasMedia: false },
  { id: 'wa-07', sender: 'Sarah Chen', senderRole: 'Coach', recipient: 'Liam Foster', recipientRole: 'Learner', message: 'Quick reminder: Progress Review meeting tomorrow at 10:00. Please prepare your portfolio.', timestamp: '7 Jun, 10:00', status: 'read', category: 'Reminder', hasMedia: false },
  { id: 'wa-08', sender: 'James Harrington', senderRole: 'Coach', recipient: 'David Chen', recipientRole: 'Learner', message: 'Hi David, here is the resource link for the Code Review session: [link]', timestamp: '6 Jun, 16:30', status: 'replied', category: 'Resource', hasMedia: true },
  { id: 'wa-09', sender: 'Med Maher', senderRole: 'Coach', recipient: 'Aisha Patel', recipientRole: 'Learner', message: 'Aisha, I have reviewed your leave request. Approved for the Taxation Module session. Let us plan the catch-up.', timestamp: '6 Jun, 09:00', status: 'replied', category: 'Absence', hasMedia: false },
  { id: 'wa-10', sender: 'Tom Harrington', senderRole: 'Engagement Manager', recipient: 'Unilever HR', recipientRole: 'Employer', message: 'Hi team, just checking in on James workplace support. Can we schedule a brief call this week?', timestamp: '5 Jun, 11:00', status: 'read', category: 'Employer', hasMedia: false },
];

export default function WhatsAppLogsPage() {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const filtered = WHATSAPP_LOGS.filter(w => {
    const matchCat = categoryFilter === 'all' || w.category === categoryFilter;
    const matchStatus = statusFilter === 'all' || w.status === statusFilter;
    return matchCat && matchStatus;
  });

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="WhatsApp Logs" pageSubtitle="View WhatsApp message logs with learners for engagement tracking"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="WhatsApp Communication Logs"
          description={`${WHATSAPP_LOGS.length} WhatsApp messages in the last 7 days. ${WHATSAPP_LOGS.filter(w => w.status === 'replied').length} conversations active. ${WHATSAPP_LOGS.filter(w => w.status === 'delivered').length} awaiting response.`}
          icon="ri-whatsapp-line"
          imageUrl="https://readdy.ai/api/search-image?query=mobile%20phone%20messaging%20whatsapp%20communication%20modern%20professional%20warm%20lighting&width=400&height=160&seq=whatsapp-01&orientation=landscape"
          imageAlt="WhatsApp Logs"
          stats={[{ label: 'Messages', value: String(WHATSAPP_LOGS.length) }, { label: 'Replied', value: String(WHATSAPP_LOGS.filter(w => w.status === 'replied').length) }, { label: 'Pending', value: String(WHATSAPP_LOGS.filter(w => w.status === 'delivered').length) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/communication')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-background-200/50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-message-2-line text-sm"></i> Communication Centre
          </button>
          <button onClick={() => navigate('/engagement/call-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-background-200/50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-phone-line text-sm"></i> Call Logs
          </button>
          <button onClick={() => navigate('/engagement/email-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-background-200/50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-mail-line text-sm"></i> Email Logs
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-background-200/50 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {['all', 'Attendance', 'Absence', 'Employer', 'Reschedule', 'Check-in', 'Reminder', 'Recognition', 'Resource'].map(cat => (
            <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>

        {/* WhatsApp List */}
        <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">WhatsApp Messages</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} messages</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(msg => (
              <div key={msg.id} className="p-4 flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <i className="ri-whatsapp-line text-sm"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[12px] font-semibold text-foreground-900">{msg.sender}</span>
                    <span className="text-[8px] text-foreground-400">({msg.senderRole})</span>
                    <i className="ri-arrow-right-line text-[10px] text-foreground-300"></i>
                    <span className="text-[12px] font-semibold text-foreground-700">{msg.recipient}</span>
                    <span className="text-[8px] text-foreground-400">({msg.recipientRole})</span>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{msg.category}</span>
                  </div>
                  <p className="text-[11px] text-foreground-600 mb-2">{msg.message}</p>
                  <div className="flex items-center gap-3 text-[10px] text-foreground-400">
                    <span>{msg.timestamp}</span>
                    <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded-full ${msg.status === 'read' ? 'bg-emerald-100 text-emerald-700' : msg.status === 'replied' ? 'bg-primary-100 text-primary-700' : 'bg-amber-100 text-amber-700'}`}>{msg.status}</span>
                    {msg.hasMedia && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700"><i className="ri-attachment-2 mr-0.5"></i>Media</span>}
                  </div>
                </div>
                <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
                  <i className="ri-reply-line mr-1"></i> Reply
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}