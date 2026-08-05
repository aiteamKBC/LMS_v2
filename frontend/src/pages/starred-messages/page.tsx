import { useState, useEffect } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';

interface StarredMessage {
  id: string;
  threadId: string;
  contactName: string;
  contactInitials: string;
  contactColor: string;
  contactRole: string;
  text: string;
  time: string;
  date: string;
  isFromMe: boolean;
  starredAt: string;
  fileName?: string;
  fileType?: 'image' | 'file';
}

// Storage key for persisting starred messages
const STARRED_KEY = 'kbc_starred_messages';

function loadStarred(): StarredMessage[] {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Demo starred messages per role if none stored
const demoStarredByRole: Record<string, StarredMessage[]> = {
  learner: [
    {
      id: 'star-l-1',
      threadId: 'th-01',
      contactName: 'Med Maher',
      contactInitials: 'MM',
      contactColor: 'bg-primary-100 text-primary-700',
      contactRole: 'Progress Coach',
      text: 'Your evidence for Week 3 was strong. Keep linking to KSB K5, K6, and S8. See you on the 18th!',
      time: '4:32 PM',
      date: '8 Jun 2026',
      isFromMe: false,
      starredAt: '10 Jun 2026, 09:00',
    },
    {
      id: 'star-l-2',
      threadId: 'th-02',
      contactName: 'Crispin Jones',
      contactInitials: 'CJ',
      contactColor: 'bg-accent-100 text-accent-700',
      contactRole: 'Tutor',
      text: 'Your Module 7 assignment has been marked. You scored 87/100 — well done! Keep up the great work. The quantitative improvement will come with practice.',
      time: '3:20 PM',
      date: '6 Jun 2026',
      isFromMe: false,
      starredAt: '9 Jun 2026, 14:30',
    },
    {
      id: 'star-l-3',
      threadId: 'th-01',
      contactName: 'Med Maher',
      contactInitials: 'MM',
      contactColor: 'bg-primary-100 text-primary-700',
      contactRole: 'Progress Coach',
      text: 'Bring a specific example from Tim Hortons — perhaps the breakfast vs lunch customer split you mentioned to Lauren. This will really strengthen your evidence.',
      time: '2:15 PM',
      date: '8 Jun 2026',
      isFromMe: false,
      starredAt: '9 Jun 2026, 10:15',
    },
  ],
  coach: [
    {
      id: 'star-c-1',
      threadId: 'th-03',
      contactName: 'Lauren Mitchell',
      contactInitials: 'LM',
      contactColor: 'bg-accent-100 text-accent-700',
      contactRole: 'Line Manager',
      text: 'I have spoken with Sophie and she has agreed to an increased workplace supervision plan. Can we schedule a joint meeting to go through the details?',
      time: '15:20',
      date: '9 Jun 2026',
      isFromMe: false,
      starredAt: '10 Jun 2026, 08:45',
    },
    {
      id: 'star-c-2',
      threadId: 'th-05',
      contactName: 'System Notification',
      contactInitials: 'SY',
      contactColor: 'bg-amber-100 text-amber-700',
      contactRole: 'Platform Alert',
      text: 'Automated alert: Finn Murphy is now 2 months behind on OTJH recording. Current: 34 hours recorded of 100 target. Recommended action: schedule urgent coaching intervention.',
      time: '11:00',
      date: '9 Jun 2026',
      isFromMe: false,
      starredAt: '9 Jun 2026, 11:05',
    },
  ],
  admin: [
    {
      id: 'star-a-1',
      threadId: 'th-02',
      contactName: 'Tom Bradley',
      contactInitials: 'TB',
      contactColor: 'bg-accent-100 text-accent-700',
      contactRole: 'QA Officer',
      text: 'Please also mark this as urgent in the audit trail. We have Ofsted readiness checks coming up and cannot have unresolved QA failures.',
      time: '11:35',
      date: '10 Jun 2026',
      isFromMe: false,
      starredAt: '10 Jun 2026, 11:40',
    },
  ],
  default: [],
};

function getRoleKey(role: string): string {
  const known = ['learner', 'coach', 'admin', 'tutor', 'employer', 'compliance', 'qa', 'leadership', 'mis', 'finance', 'auditor'];
  return known.includes(role) ? role : 'default';
}

const categoryColors: Record<string, string> = {
  coach: 'bg-primary-100 text-primary-700',
  tutor: 'bg-accent-100 text-accent-700',
  employer: 'bg-secondary-100 text-secondary-700',
  system: 'bg-amber-100 text-amber-700',
  default: 'bg-background-100 text-foreground-600',
};

function getCategoryColor(role: string): string {
  const r = role.toLowerCase();
  if (r.includes('coach') || r.includes('progress')) return categoryColors.coach;
  if (r.includes('tutor') || r.includes('curriculum')) return categoryColors.tutor;
  if (r.includes('employer') || r.includes('manager') || r.includes('manager')) return categoryColors.employer;
  if (r.includes('system') || r.includes('alert') || r.includes('automation') || r.includes('notification')) return categoryColors.system;
  return categoryColors.default;
}

export default function StarredMessagesPage() {
  const { auth } = useAuth();
  const role = auth.roles[0]?.slug || 'learner';
  const nav = roleNavMap[role] || roleNavMap.learner;
  const roleKey = getRoleKey(role);

  const [starred, setStarred] = useState<StarredMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterContact, setFilterContact] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'starred' | 'date'>('starred');

  // Load starred messages: from localStorage or use role demo data
  useEffect(() => {
    const stored = loadStarred();
    const roleStored = stored.filter(s => (s as StarredMessage & { role?: string }).role === roleKey);
    if (roleStored.length > 0) {
      setStarred(roleStored);
    } else {
      setStarred(demoStarredByRole[roleKey] || demoStarredByRole.default);
    }
  }, [roleKey]);

  const handleUnstar = (msgId: string) => {
    const updated = starred.filter(s => s.id !== msgId);
    setStarred(updated);
    // Persist in localStorage
    const stored = loadStarred().filter(s => s.id !== msgId);
    localStorage.setItem(STARRED_KEY, JSON.stringify(stored));
    // Dispatch event so message pages can sync
    window.dispatchEvent(new CustomEvent('starred-messages-changed', { detail: { msgId, starred: false } }));
  };

  const uniqueContacts = Array.from(new Set(starred.map(s => s.contactName)));

  const filtered = starred.filter(s => {
    if (filterContact !== 'all' && s.contactName !== filterContact) return false;
    if (searchQuery && !s.text.toLowerCase().includes(searchQuery.toLowerCase()) && !s.contactName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'starred') return b.starredAt.localeCompare(a.starredAt);
    return b.date.localeCompare(a.date);
  });

  const getRoleMeta = () => {
    const metas: Record<string, { userName: string; userRole: string }> = {
      coach: { userName: 'Med Maher', userRole: 'Progress Coach' },
      learner: { userName: 'Sarah Mitchell', userRole: 'Marketing Executive L4 Apprentice' },
      tutor: { userName: 'Helen Curtis', userRole: 'Tutor' },
      compliance: { userName: 'Rebecca Holmes', userRole: 'Compliance Officer' },
      mis: { userName: 'Priya Sharma', userRole: 'MIS Operations Lead' },
      qa: { userName: 'Tom Bradley', userRole: 'QA Officer' },
      leadership: { userName: 'Dr. Karen Ashby', userRole: 'Principal / CEO' },
      admin: { userName: 'Alex Carter', userRole: 'System Administrator' },
      employer: { userName: 'Mark Davies', userRole: 'Line Manager' },
      curriculum: { userName: 'Rachel Myers', userRole: 'Curriculum Designer' },
      engagement: { userName: 'Rebecca Holmes', userRole: 'Engagement Manager' },
      finance: { userName: 'Lisa Nguyen', userRole: 'Finance Officer' },
      auditor: { userName: 'Tom Bradley', userRole: 'QA & Audit Director' },
    };
    return metas[role] || { userName: 'User', userRole: 'Team Member' };
  };

  const meta = getRoleMeta();

  return (
    <WorkspaceShell
      role={role}
      roleLabel={nav.label}
      navItems={nav.items}
      workspaceLabel={nav.workspaceLabel || 'Messages'}
      pageTitle="Starred Messages"
      pageSubtitle="Your personally bookmarked messages — visible only to you"
      userName={meta.userName}
      userRole={meta.userRole}
    >
      <div className="min-h-[calc(100vh-140px)] bg-background-50">
        {/* Header bar */}
        <div className="px-6 py-4 border-b border-background-200/50 bg-background-50 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Search */}
            <div className="relative">
              <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
              <input
                type="text"
                placeholder="Search starred messages..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 rounded-xl border border-background-200 bg-background-100 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth w-56"
              />
            </div>

            {/* Filter by contact */}
            <select
              value={filterContact}
              onChange={e => setFilterContact(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm border border-background-200 bg-background-100 text-foreground-700 outline-none focus:border-primary-300 cursor-pointer"
            >
              <option value="all">All contacts</option>
              {uniqueContacts.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            {/* Sort */}
            <div className="flex items-center gap-1 bg-background-100 rounded-xl border border-background-200 p-1">
              <button
                onClick={() => setSortBy('starred')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                  sortBy === 'starred' ? 'bg-background-50 text-foreground-800 border border-background-200' : 'text-foreground-400 hover:text-foreground-600'
                }`}
              >
                Recently starred
              </button>
              <button
                onClick={() => setSortBy('date')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                  sortBy === 'date' ? 'bg-background-50 text-foreground-800 border border-background-200' : 'text-foreground-400 hover:text-foreground-600'
                }`}
              >
                Message date
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200/50 px-3 py-1.5 rounded-xl">
              <AppIcon className="ri-star-fill text-amber-500 text-sm"></AppIcon>
              <span className="text-xs font-semibold text-amber-700">{starred.length} starred</span>
            </div>
            <div className="flex items-center gap-1.5 bg-accent-50 border border-accent-200/40 px-3 py-1.5 rounded-xl">
              <AppIcon className="ri-lock-line text-accent-600 text-xs"></AppIcon>
              <span className="text-xs text-accent-700 font-medium">Visible only to you</span>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-3xl mx-auto px-6 py-6">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200/50 flex items-center justify-center mb-5">
                <AppIcon className="ri-star-line text-2xl text-amber-400"></AppIcon>
              </div>
              <h3 className="text-base font-heading font-semibold text-foreground-500 mb-2">
                {searchQuery || filterContact !== 'all' ? 'No matching starred messages' : 'No starred messages yet'}
              </h3>
              <p className="text-sm text-foreground-300 max-w-sm leading-relaxed">
                {searchQuery || filterContact !== 'all'
                  ? 'Try adjusting your search or filter to find what you\'re looking for.'
                  : 'Right-click any message and select "Star message" to save it here for quick access. Only you can see your starred messages.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((msg, i) => (
                <div
                  key={msg.id}
                  className="group bg-background-50 border border-background-200/50 rounded-2xl p-5 transition-smooth hover:border-amber-200/60 hover:bg-amber-50/20 animate-in fade-in slide-in-from-bottom-1 duration-300"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${msg.contactColor}`}>
                      {msg.isFromMe ? 'You' : msg.contactInitials}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground-800">
                          {msg.isFromMe ? 'You' : msg.contactName}
                        </span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${getCategoryColor(msg.contactRole)}`}>
                          {msg.contactRole}
                        </span>
                        <span className="text-[10px] text-foreground-300 ml-auto shrink-0">
                          {msg.date} · {msg.time}
                        </span>
                      </div>

                      {msg.fileType === 'image' ? (
                        <div className="flex items-center gap-2 mb-2 text-foreground-500">
                          <AppIcon className="ri-image-line text-sm"></AppIcon>
                          <span className="text-sm italic">{msg.fileName || 'Image'}</span>
                        </div>
                      ) : msg.fileType === 'file' ? (
                        <div className="flex items-center gap-2 mb-2 text-foreground-500">
                          <AppIcon className="ri-file-line text-sm"></AppIcon>
                          <span className="text-sm italic">{msg.fileName || 'File'}</span>
                        </div>
                      ) : (
                        <p className="text-sm text-foreground-700 leading-relaxed mb-3">{msg.text}</p>
                      )}

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-[10px] text-amber-600">
                          <AppIcon className="ri-star-fill text-amber-400 text-xs"></AppIcon>
                          <span>Starred {msg.starredAt}</span>
                        </div>
                        <div className="w-1 h-1 rounded-full bg-foreground-200"></div>
                        <span className="text-[10px] text-foreground-400">
                          <AppIcon className="ri-lock-line text-[9px] mr-0.5"></AppIcon>
                          Only visible to you
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-smooth">
                      <button
                        onClick={() => handleUnstar(msg.id)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-smooth cursor-pointer"
                        title="Remove star"
                      >
                        <AppIcon className="ri-star-fill text-sm"></AppIcon>
                      </button>
                      <button
                        onClick={() => navigator.clipboard?.writeText(msg.text)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                        title="Copy text"
                      >
                        <AppIcon className="ri-file-copy-line text-sm"></AppIcon>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}