import { useState, useMemo, useRef, useCallback } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';
import TypingIndicator from '@/components/feature/TypingIndicator';
import { highlightText } from '@/components/feature/HighlightText';

interface Contact {
  id: string;
  name: string;
  initials: string;
  role: string;
  org: string;
  avatarColor: string;
  online: boolean;
  lastSeen: string;
}

interface Thread {
  id: string;
  contactId: string;
  subject: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
  starred: boolean;
  category: string;
  attachments: number;
  messages: ThreadMessage[];
}

interface ThreadMessage {
  id: string;
  fromName: string;
  fromInitials: string;
  body: string;
  timestamp: string;
  mine: boolean;
  attachments?: string[];
}

const avatarColors = ['bg-primary-100 text-primary-700', 'bg-accent-100 text-accent-700', 'bg-secondary-100 text-secondary-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-red-100 text-red-700'];

const ROLE_CONTACTS: Record<string, Contact[]> = {
  coach: [
    { id: 'c1', name: 'Sophie Williams', initials: 'SW', role: 'Learner · ME L4', org: 'Asda', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'c2', name: 'Tom Richards', initials: 'TR', role: 'Learner · ME L4', org: 'KCC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 1h ago' },
    { id: 'c3', name: 'Lauren Mitchell', initials: 'LM', role: 'Line Manager', org: 'Tim Hortons UK', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'c4', name: 'David Chen', initials: 'DC', role: 'Learner · SD L4', org: 'BAM', avatarColor: avatarColors[3], online: false, lastSeen: 'Last seen 3h ago' },
    { id: 'c5', name: 'Helen Curtis', initials: 'HC', role: 'Tutor', org: 'KBC', avatarColor: avatarColors[4], online: true, lastSeen: 'Active now' },
    { id: 'c6', name: 'Tom Bradley', initials: 'TB', role: 'QA Officer', org: 'KBC', avatarColor: avatarColors[5], online: false, lastSeen: 'Last seen 1d ago' },
    { id: 'c7', name: 'System Alerts', initials: 'SA', role: 'Platform', org: 'KBC', avatarColor: avatarColors[3], online: true, lastSeen: 'Active now' },
    { id: 'c8', name: 'Sarah Khan', initials: 'SK', role: 'Fellow Coach', org: 'KBC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 2d ago' },
  ],
  learner: [
    { id: 'l1', name: 'Martin Reeves', initials: 'MRe', role: 'Coach', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'l2', name: 'Helen Curtis', initials: 'HC', role: 'Tutor', org: 'KBC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 2h ago' },
    { id: 'l3', name: 'Mark Davies', initials: 'MD', role: 'Line Manager', org: 'KCC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'l4', name: 'Learner Support', initials: 'LS', role: 'Support Team', org: 'KBC', avatarColor: avatarColors[3], online: true, lastSeen: 'Active now' },
    { id: 'l5', name: 'Sarah Mitchell', initials: 'SM', role: 'Fellow Apprentice', org: 'KCC', avatarColor: avatarColors[4], online: true, lastSeen: 'Active now' },
  ],
  tutor: [
    { id: 't1', name: 'Sophie Williams', initials: 'SW', role: 'Learner · ME L4', org: 'Asda', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 't2', name: 'Martin Reeves', initials: 'MRe', role: 'Coach', org: 'KBC', avatarColor: avatarColors[1], online: true, lastSeen: 'Active now' },
    { id: 't3', name: 'Tom Bradley', initials: 'TB', role: 'QA Officer', org: 'KBC', avatarColor: avatarColors[2], online: false, lastSeen: 'Last seen 1d ago' },
    { id: 't4', name: 'Rachel Myers', initials: 'RM', role: 'Curriculum', org: 'KBC', avatarColor: avatarColors[3], online: false, lastSeen: 'Last seen 3h ago' },
    { id: 't5', name: 'Liam Patel', initials: 'LP', role: 'Learner · BA L3', org: 'NHS', avatarColor: avatarColors[4], online: true, lastSeen: 'Active now' },
  ],
  compliance: [
    { id: 'co1', name: 'Liam Patel', initials: 'LP', role: 'Learner · BA L3', org: 'NHS', avatarColor: avatarColors[0], online: false, lastSeen: 'Last seen 2h ago' },
    { id: 'co2', name: 'Tom Bradley', initials: 'TB', role: 'QA Officer', org: 'KBC', avatarColor: avatarColors[1], online: true, lastSeen: 'Active now' },
    { id: 'co3', name: 'KCC HR Team', initials: 'KH', role: 'Employer HR', org: 'KCC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'co4', name: 'Admin Team', initials: 'AT', role: 'Admin', org: 'KBC', avatarColor: avatarColors[3], online: true, lastSeen: 'Active now' },
    { id: 'co5', name: 'DAS Support', initials: 'DS', role: 'ESFA', org: 'ESFA', avatarColor: avatarColors[4], online: false, lastSeen: 'Last seen 1d ago' },
  ],
  mis: [
    { id: 'm1', name: 'Rachel Myers', initials: 'RM', role: 'Curriculum', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'm2', name: 'Dr. Karen Ashby', initials: 'KA', role: 'CEO', org: 'KBC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 3h ago' },
    { id: 'm3', name: 'Martin Reeves', initials: 'MRe', role: 'Coach', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'm4', name: 'Lisa Nguyen', initials: 'LN', role: 'Finance', org: 'KBC', avatarColor: avatarColors[3], online: true, lastSeen: 'Active now' },
  ],
  qa: [
    { id: 'q1', name: 'Martin Reeves', initials: 'MRe', role: 'Coach', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'q2', name: 'Helen Curtis', initials: 'HC', role: 'Tutor', org: 'KBC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 2h ago' },
    { id: 'q3', name: 'Compliance Team', initials: 'CT', role: 'Compliance', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'q4', name: 'Dr. Karen Ashby', initials: 'KA', role: 'Principal', org: 'KBC', avatarColor: avatarColors[3], online: false, lastSeen: 'Last seen 1d ago' },
  ],
  leadership: [
    { id: 'ld1', name: 'Martin Reeves', initials: 'MRe', role: 'Head of Coaching', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'ld2', name: 'Tom Bradley', initials: 'TB', role: 'QA Director', org: 'KBC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 4h ago' },
    { id: 'ld3', name: 'Priya Sharma', initials: 'PS', role: 'MIS Lead', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'ld4', name: 'Board of Governors', initials: 'BG', role: 'Governance', org: 'KBC', avatarColor: avatarColors[3], online: false, lastSeen: 'Last seen 2d ago' },
  ],
  admin: [
    { id: 'a1', name: 'Dr. Karen Ashby', initials: 'KA', role: 'CEO', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'a2', name: 'All Coaches', initials: 'AC', role: 'Coach Group', org: 'KBC', avatarColor: avatarColors[1], online: true, lastSeen: 'Active now' },
    { id: 'a3', name: 'Compliance Team', initials: 'CT', role: 'Compliance', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'a4', name: 'System Alerts', initials: 'SA', role: 'Platform', org: 'KBC', avatarColor: avatarColors[3], online: true, lastSeen: 'Active now' },
    { id: 'a5', name: 'All Learners', initials: 'AL', role: 'Learner Group', org: 'KBC', avatarColor: avatarColors[4], online: false, lastSeen: '—' },
  ],
  employer: [
    { id: 'e1', name: 'Martin Reeves', initials: 'MRe', role: 'Coach', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'e2', name: 'Sophie Williams', initials: 'SW', role: 'Apprentice', org: 'KCC', avatarColor: avatarColors[1], online: true, lastSeen: 'Active now' },
    { id: 'e3', name: 'KBC Admin', initials: 'KA', role: 'Admin Support', org: 'KBC', avatarColor: avatarColors[2], online: false, lastSeen: 'Last seen 3h ago' },
  ],
  curriculum: [
    { id: 'cu1', name: 'Priya Sharma', initials: 'PS', role: 'MIS Lead', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'cu2', name: 'Tom Bradley', initials: 'TB', role: 'QA Officer', org: 'KBC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 5h ago' },
    { id: 'cu3', name: 'Martin Reeves', initials: 'MRe', role: 'Head of Coaching', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'cu4', name: 'James Cooper', initials: 'JC', role: 'Curriculum', org: 'KBC', avatarColor: avatarColors[3], online: false, lastSeen: 'Last seen 1d ago' },
    { id: 'cu5', name: 'Dr. Karen Ashby', initials: 'KA', role: 'CEO', org: 'KBC', avatarColor: avatarColors[4], online: false, lastSeen: 'Last seen 2d ago' },
  ],
  engagement: [
    { id: 'eg1', name: 'Martin Reeves', initials: 'MRe', role: 'Coach', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'eg2', name: 'Mia Robinson', initials: 'MRo', role: 'Learner · PM L4', org: 'Tesco', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 4h ago' },
    { id: 'eg3', name: 'Admin Team', initials: 'AT', role: 'Admin', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'eg4', name: 'System Alerts', initials: 'SA', role: 'Platform', org: 'KBC', avatarColor: avatarColors[3], online: true, lastSeen: 'Active now' },
  ],
  finance: [
    { id: 'fi1', name: 'Dr. Karen Ashby', initials: 'KA', role: 'CEO', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'fi2', name: 'DAS Support', initials: 'DS', role: 'ESFA', org: 'ESFA', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 1d ago' },
    { id: 'fi3', name: 'Admin Team', initials: 'AT', role: 'Admin', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'fi4', name: 'MIS Team', initials: 'MI', role: 'MIS', org: 'KBC', avatarColor: avatarColors[3], online: false, lastSeen: 'Last seen 2d ago' },
  ],
  auditor: [
    { id: 'au1', name: 'Dr. Karen Ashby', initials: 'KA', role: 'Principal', org: 'KBC', avatarColor: avatarColors[0], online: true, lastSeen: 'Active now' },
    { id: 'au2', name: 'Tom Bradley', initials: 'TB', role: 'QA Director', org: 'KBC', avatarColor: avatarColors[1], online: false, lastSeen: 'Last seen 1d ago' },
    { id: 'au3', name: 'Martin Reeves', initials: 'MRe', role: 'Head of Coaching', org: 'KBC', avatarColor: avatarColors[2], online: true, lastSeen: 'Active now' },
    { id: 'au4', name: 'Compliance Team', initials: 'CT', role: 'Compliance', org: 'KBC', avatarColor: avatarColors[3], online: false, lastSeen: 'Last seen 3h ago' },
  ],
};

const buildThreads = (contact: Contact, role: string, index: number): Thread[] => {
  const threads: Thread[] = [];
  if (role === 'coach') {
    if (index === 0) threads.push({ id: 'th-coach-1', contactId: contact.id, subject: 'Monthly Check-in Prep', lastMessage: 'I have uploaded the latest evidence pack. Can we confirm the date for the review?', timestamp: '10 min ago', unread: true, starred: true, category: 'Coaching', attachments: 1, messages: [
      { id: 'm1', fromName: 'Sophie Williams', fromInitials: 'SW', body: 'Hi Martin, I have uploaded the latest evidence pack for Module 3. Can we confirm the date for the monthly review? I would prefer next Tuesday or Wednesday afternoon.', timestamp: 'Today 09:14', mine: false, attachments: ['Evidence_Pack_M3.pdf'] },
      { id: 'm2', fromName: 'Martin Reeves', fromInitials: 'MR', body: 'Hi Sophie, great work on the evidence pack — it looks solid. Tuesday at 2pm works well for me. I will send a Teams link shortly.', timestamp: 'Today 09:32', mine: true },
      { id: 'm3', fromName: 'Sophie Williams', fromInitials: 'SW', body: 'Perfect, Tuesday at 2pm works for me. Should I prepare anything specific for the review session?', timestamp: '10 min ago', mine: false },
    ]});
  }
  if (role === 'learner') {
    if (index === 0) threads.push({ id: 'th-learner-1', contactId: contact.id, subject: 'Monthly Check-in — Tuesday 2pm', lastMessage: 'I have sent the Teams link for Tuesday. Please have your evidence pack ready.', timestamp: '10 min ago', unread: true, starred: true, category: 'Coaching', attachments: 0, messages: [
      { id: 'm1', fromName: 'Sarah Mitchell', fromInitials: 'SM', body: 'Hi Martin, I have uploaded the latest evidence pack. Can we confirm the date?', timestamp: 'Today 09:14', mine: true },
      { id: 'm2', fromName: 'Martin Reeves', fromInitials: 'MR', body: 'Hi Sarah! Great work on the evidence pack. Tuesday at 2pm works well. I will send a Teams link shortly.', timestamp: 'Today 09:32', mine: false },
      { id: 'm3', fromName: 'Martin Reeves', fromInitials: 'MR', body: 'Teams link sent. Please have your evidence portfolio ready and we can walk through KSB mapping together.', timestamp: '10 min ago', mine: false },
    ]});
  }
  if (threads.length === 0) {
    const cats = ['Coaching', 'QA', 'Employer', 'Compliance', 'System', 'Academic'];
    const subjs = ['Status Update', 'Review Requested', 'Action Required', 'New Message', 'Weekly Digest', 'Follow-up'];
    const msgs = [
      'Please review the attached document and provide feedback by end of week.',
      'The latest report is ready for your review. Let me know if you have any questions.',
      'Can we schedule a quick call to discuss the current priorities?',
      'I have completed the requested task. Please confirm when you have a moment.',
      'A quick update on the ongoing project — everything is on track for the deadline.',
      'Following up on our last conversation — any updates on your end?',
    ];
    threads.push({
      id: `th-${role}-${index}`,
      contactId: contact.id,
      subject: subjs[index % subjs.length],
      lastMessage: msgs[index % msgs.length],
      timestamp: index === 0 ? 'Just now' : `${index + 1}h ago`,
      unread: index < 3,
      starred: index === 0,
      category: cats[index % cats.length],
      attachments: index % 3 === 0 ? 1 : 0,
      messages: [
        { id: 'm1', fromName: contact.name, fromInitials: contact.initials, body: msgs[(index + 1) % msgs.length], timestamp: 'Today', mine: false },
        { id: 'm2', fromName: 'Me', fromInitials: 'ME', body: msgs[index % msgs.length], timestamp: 'Just now', mine: true },
      ],
    });
  }
  return threads;
};

const ROLE_THREADS: Record<string, Thread[]> = Object.fromEntries(
  Object.entries(ROLE_CONTACTS).map(([role, contacts]) => [
    role,
    contacts.flatMap((c, i) => buildThreads(c, role, i)),
  ])
);

const ROLE_META: Record<string, { userName: string; userRole: string; navKey: string }> = {
  coach: { userName: 'Martin Reeves', userRole: 'Coach', navKey: 'coach' },
  learner: { userName: 'Sarah Mitchell', userRole: 'Marketing Executive L4 Apprentice', navKey: 'learner' },
  tutor: { userName: 'Helen Curtis', userRole: 'Tutor', navKey: 'tutor' },
  compliance: { userName: 'Rebecca Holmes', userRole: 'Compliance Officer', navKey: 'compliance' },
  mis: { userName: 'Priya Sharma', userRole: 'MIS Operations Lead', navKey: 'mis' },
  qa: { userName: 'Tom Bradley', userRole: 'QA Officer', navKey: 'qa' },
  leadership: { userName: 'Dr. Karen Ashby', userRole: 'Principal / CEO', navKey: 'leadership' },
  admin: { userName: 'Alex Carter', userRole: 'System Administrator', navKey: 'admin' },
  employer: { userName: 'Mark Davies', userRole: 'Line Manager', navKey: 'employer' },
  curriculum: { userName: 'Rachel Myers', userRole: 'Curriculum Designer', navKey: 'curriculum' },
  engagement: { userName: 'Rebecca Holmes', userRole: 'Engagement Manager', navKey: 'engagement' },
  finance: { userName: 'Lisa Nguyen', userRole: 'Finance Officer', navKey: 'finance' },
  auditor: { userName: 'Tom Bradley', userRole: 'QA & Audit Director', navKey: 'auditor' },
};

const catBadgeColors: Record<string, string> = {
  Coaching: 'bg-primary-100 text-primary-700',
  QA: 'bg-amber-100 text-amber-700',
  Employer: 'bg-accent-100 text-accent-700',
  Compliance: 'bg-primary-100 text-primary-700',
  System: 'bg-foreground-100 text-foreground-700',
  Academic: 'bg-secondary-100 text-secondary-700',
  'At-Risk': 'bg-red-100 text-red-700',
  Escalation: 'bg-red-100 text-red-700',
  Leadership: 'bg-secondary-100 text-secondary-700',
  Audit: 'bg-accent-100 text-accent-700',
  Funding: 'bg-emerald-100 text-emerald-700',
};

const AUTO_REPLIES: string[] = [
  'Thanks for the message! I will review and get back to you shortly.',
  'Got it — thanks for the update. Let me check and follow up.',
  'Appreciate it! I will take a look and respond properly soon.',
  'Noted, thanks for flagging this. I will keep you posted.',
  'Great, I am on it. Talk soon!',
];

export default function CommunicationPage() {
  const { auth } = useAuth();
  const role = auth.roles[0]?.slug || 'coach';
  const meta = ROLE_META[role] || ROLE_META.coach;
  const nav = roleNavMap[meta.navKey];

  const contacts = ROLE_CONTACTS[role] || ROLE_CONTACTS.coach;
  const [threads, setThreads] = useState<Thread[]>(ROLE_THREADS[role] || ROLE_THREADS.coach);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeToId, setComposeToId] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredThreads = useMemo(() => {
    if (!searchQuery) return threads;
    return threads.filter(t => {
      const contact = contacts.find(c => c.id === t.contactId);
      return (
        (contact?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [threads, searchQuery, contacts]);

  const totalUnread = threads.reduce((sum, t) => sum + (t.unread ? 1 : 0), 0);

  const getAutoReply = useCallback((): string => {
    return AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)];
  }, []);

  const handleSend = () => {
    if (!newMessage.trim() || !activeThreadId) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const msg: ThreadMessage = {
      id: `u-${Date.now()}`,
      fromName: meta.userName,
      fromInitials: meta.userName.split(' ').map((n: string) => n[0]).join(''),
      body: newMessage.trim(),
      timestamp: `Today ${timeStr}`,
      mine: true,
    };
    setThreads(prev => prev.map(t =>
      t.id === activeThreadId
        ? { ...t, messages: [...t.messages, msg], lastMessage: newMessage.trim(), timestamp: 'Just now' }
        : t
    ));
    setNewMessage('');

    setIsTyping(true);
    const delay = 1800 + Math.random() * 2500;
    const contact = contacts.find(c => c.id === threads.find(t => t.id === activeThreadId)?.contactId);
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
      const replyTime = new Date();
      const replyTimeStr = replyTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const reply: ThreadMessage = {
        id: `r-${Date.now()}`,
        fromName: contact?.name || 'Contact',
        fromInitials: contact?.initials || '?',
        body: getAutoReply(),
        timestamp: `Today ${replyTimeStr}`,
        mine: false,
      };
      setThreads(prev => prev.map(t =>
        t.id === activeThreadId
          ? { ...t, messages: [...t.messages, reply], lastMessage: getAutoReply(), timestamp: 'Just now' }
          : t
      ));
      typingTimerRef.current = null;
    }, delay);
  };

  const openThread = (id: string) => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      setIsTyping(false);
      typingTimerRef.current = null;
    }
    setActiveThreadId(id);
    setThreads(prev => prev.map(t => t.id === id ? { ...t, unread: false } : t));
  };

  const handleComposeSend = () => {
    if (!composeToId || !composeSubject || !composeBody) return;
    const contact = contacts.find(c => c.id === composeToId);
    if (!contact) return;
    const newId = `th-new-${Date.now()}`;
    const newThread: Thread = {
      id: newId, contactId: composeToId, subject: composeSubject,
      lastMessage: composeBody, timestamp: 'Just now', unread: false, starred: false,
      category: 'Coaching', attachments: 0,
      messages: [{ id: 'm1', fromName: meta.userName, fromInitials: meta.userName.split(' ').map((n: string) => n[0]).join(''), body: composeBody, timestamp: 'Just now', mine: true }],
    };
    setThreads(prev => [newThread, ...prev]);
    setShowCompose(false);
    setComposeToId(''); setComposeSubject(''); setComposeBody('');
    setActiveThreadId(newId);
  };

  const activeThread = activeThreadId ? threads.find(t => t.id === activeThreadId) : null;
  const activeContact = activeThread ? contacts.find(c => c.id === activeThread.contactId) : null;

  return (
    <WorkspaceShell
      role={role} roleLabel={nav?.label || meta.userRole}
      navItems={nav?.items || []}
      workspaceLabel={nav?.workspaceLabel || 'Communication'}
      pageTitle="Messages" pageSubtitle="Your inbox and communication centre"
      userName={meta.userName} userRole={meta.userRole}
    >
      <div className="flex h-[calc(100vh-140px)]">
        {/* Thread List Sidebar */}
        <div className="w-full lg:w-[360px] border-r border-background-200/50 bg-background-50 flex flex-col shrink-0">
          <div className="p-4 border-b border-foreground-300/50">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-heading font-semibold text-foreground-900">Messages</h2>
              <button onClick={() => setShowCompose(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-edit-line text-[11px]"></i> Compose
              </button>
            </div>
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
              <input type="text" placeholder="Search messages..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-100 text-[12px] text-foreground-700 outline-none focus:border-primary-300 transition-smooth" />
            </div>
          </div>

          {totalUnread > 0 && (
            <div className="px-4 py-2 border-b border-foreground-300/50 bg-primary-50/50">
              <p className="text-[11px] text-primary-700 font-medium">
                <i className="ri-mail-unread-line mr-1"></i>
                {searchQuery ? `${filteredThreads.length} result${filteredThreads.length !== 1 ? 's' : ''}` : `${totalUnread} unread from ${threads.filter(t => t.unread).length} conversations`}
              </p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {filteredThreads.map(thread => {
              const contact = contacts.find(c => c.id === thread.contactId);
              return (
                <button key={thread.id} onClick={() => openThread(thread.id)} className={`w-full flex items-start gap-3 p-4 text-left transition-smooth cursor-pointer border-b border-background-200/20 hover:bg-background-100/50 ${activeThreadId === thread.id ? 'bg-primary-50/60 border-l-2 border-l-primary-400' : ''}`}>
                  <div className="relative shrink-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${contact?.avatarColor || avatarColors[0]}`}>
                      {contact?.initials || '?'}
                    </div>
                    {contact?.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white"></span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-[13px] font-semibold truncate ${thread.unread ? 'text-foreground-900' : 'text-foreground-600'}`}>
                        {highlightText(contact?.name || 'Unknown', searchQuery)}
                      </p>
                      <span className="text-[10px] text-foreground-300 shrink-0 ml-2">{thread.timestamp}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${catBadgeColors[thread.category] || 'bg-background-100 text-foreground-500'}`}>
                        {highlightText(thread.category, searchQuery)}
                      </span>
                      {thread.attachments > 0 && <span className="text-[9px] text-foreground-400"><i className="ri-attachment-2 text-[9px]"></i></span>}
                    </div>
                    <p className={`text-[11px] truncate mt-0.5 ${thread.unread ? 'text-foreground-700 font-medium' : 'text-foreground-400'}`}>
                      {highlightText(thread.lastMessage, searchQuery)}
                    </p>
                  </div>
                  {thread.unread && <span className="bg-primary-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none shrink-0 mt-1">1</span>}
                  {thread.starred && <i className="ri-star-fill text-amber-400 text-xs shrink-0 mt-1 ml-1"></i>}
                </button>
              );
            })}
            {filteredThreads.length === 0 && searchQuery && (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <i className="ri-search-line text-2xl text-foreground-200 mb-2"></i>
                <p className="text-[12px] text-foreground-400">No conversations match "{searchQuery}"</p>
              </div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="hidden lg:flex flex-1 flex-col bg-background-50">
          {activeThread && activeContact ? (
            <>
              <div className="flex items-center justify-between px-6 py-4 border-b border-foreground-300/50 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${activeContact.avatarColor}`}>
                      {activeContact.initials}
                    </div>
                    {activeContact.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white"></span>}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">{activeContact.name}</p>
                    <p className="text-[10px] text-foreground-400">
                      {isTyping ? (
                        <span className="text-primary-500 font-medium animate-in fade-in duration-300">typing...</span>
                      ) : (
                        <>{activeContact.online ? 'Online' : activeContact.lastSeen} · {activeContact.role}</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                    <i className="ri-phone-line text-sm"></i>
                  </button>
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                    <i className="ri-video-line text-sm"></i>
                  </button>
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                    <i className="ri-more-2-fill text-sm"></i>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {activeThread.messages.map((msg, i) => (
                  <div key={msg.id} className={`flex ${msg.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] ${msg.mine ? 'order-1' : ''}`}>
                      <div className={`rounded-2xl px-4 py-2.5 ${msg.mine ? 'bg-primary-500 text-white rounded-br-md' : 'bg-background-100 text-foreground-700 rounded-bl-md'}`}>
                        <p className="text-[12px] leading-relaxed whitespace-pre-line">{msg.body}</p>
                      </div>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className={`flex items-center gap-2 mt-1 ${msg.mine ? 'justify-end' : 'justify-start'}`}>
                          {msg.attachments.map(att => (
                            <span key={att} className="flex items-center gap-1 px-2 py-1 bg-background-100 border border-background-200/50 rounded-lg text-[10px] text-foreground-500 cursor-pointer">
                              <i className="ri-file-pdf-line text-red-500 text-xs"></i>{att}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className={`text-[9px] text-foreground-300 mt-0.5 ${msg.mine ? 'text-right' : 'text-left'}`}>{msg.fromName} · {msg.timestamp}</p>
                    </div>
                  </div>
                ))}

                {isTyping && <TypingIndicator />}
              </div>

              <div className="px-6 py-4 border-t border-background-200/30 shrink-0">
                <div className="flex items-center gap-2">
                  <button className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer shrink-0">
                    <i className="ri-attachment-2 text-lg"></i>
                  </button>
                  <input
                    type="text"
                    placeholder={`Message ${activeContact.name.split(' ')[0]}...`}
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 bg-background-100 text-[12px] text-foreground-700 outline-none focus:border-primary-300 transition-smooth"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!newMessage.trim()}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-smooth ${newMessage.trim() ? 'bg-primary-500 text-white hover:bg-primary-600 cursor-pointer' : 'bg-background-100 text-foreground-300 cursor-not-allowed'}`}
                  >
                    <i className="ri-send-plane-fill text-sm"></i>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <span className="w-20 h-20 rounded-2xl bg-background-100 flex items-center justify-center mb-5">
                <i className="ri-mail-line text-3xl text-foreground-300"></i>
              </span>
              <h3 className="text-base font-heading font-semibold text-foreground-400 mb-2">Your Messages</h3>
              <p className="text-[13px] text-foreground-300 max-w-sm leading-relaxed">
                Select a conversation from the left to view your messages or compose a new one.
                You have <strong className="text-primary-600">{totalUnread} unread message{totalUnread !== 1 ? 's' : ''}</strong>.
              </p>
              <button onClick={() => setShowCompose(true)} className="mt-6 px-5 py-2.5 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-edit-line mr-1.5"></i> Compose
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowCompose(false)}>
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-foreground-200/60">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">New Message</h3>
              <button onClick={() => { setShowCompose(false); setComposeToId(''); setComposeSubject(''); setComposeBody(''); }} className="w-7 h-7 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <i className="ri-close-line text-foreground-500 text-sm"></i>
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-foreground-400 uppercase tracking-wide mb-1">To</label>
                <select value={composeToId} onChange={e => setComposeToId(e.target.value)} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 outline-none focus:border-primary-400 cursor-pointer">
                  <option value="">Select recipient...</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-foreground-400 uppercase tracking-wide mb-1">Subject</label>
                <input type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Subject..." className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 placeholder:text-foreground-300 outline-none focus:border-primary-400 transition-smooth" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-foreground-400 uppercase tracking-wide mb-1">Message</label>
                <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} placeholder="Write your message..." rows={5} maxLength={500} className="w-full px-3 py-2.5 border border-background-200 rounded-xl bg-background-50 text-[13px] text-foreground-800 placeholder:text-foreground-300 outline-none focus:border-primary-400 resize-none transition-smooth" />
                <p className="text-[10px] text-foreground-400 text-right mt-0.5">{composeBody.length}/500</p>
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-foreground-200/60">
              <button className="flex items-center gap-1.5 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[11px] text-foreground-500 hover:bg-background-200 cursor-pointer whitespace-nowrap">
                <i className="ri-attachment-2 text-sm"></i>Attach
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowCompose(false); setComposeToId(''); setComposeSubject(''); setComposeBody(''); }} className="px-4 py-2 bg-background-100 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-200 cursor-pointer whitespace-nowrap">Discard</button>
                <button onClick={handleComposeSend} disabled={!composeToId || !composeSubject || !composeBody} className="px-5 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap">
                  <i className="ri-send-plane-fill mr-1 text-[10px]"></i>Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}