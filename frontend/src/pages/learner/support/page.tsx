import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';

const learnerNav = roleNavMap.learner;

type TabKey = 'tickets' | 'faq' | 'knowledge' | 'contact';

interface SupportTicket {
  id: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  submitted: string;
  lastUpdate: string;
  assignedTo: string;
  assignedTeam: string;
  messages: number;
  description: string;
  timeline: { event: string; timestamp: string; detail?: string }[];
  replies?: { id: string; sender: string; senderRole: string; body: string; timestamp: string }[];
}

interface TicketReply {
  id: string;
  sender: string;
  senderRole: string;
  body: string;
  timestamp: string;
}

interface KnowledgeArticle {
  id: string;
  title: string;
  category: string;
  excerpt: string;
  content: string;
}

const TICKETS: SupportTicket[] = [
  {
    id: 'tkt-001', title: 'Unable to upload evidence file — keeps timing out', category: 'Technical', priority: 'high', status: 'in-progress',
    submitted: '8 Jun 2026', lastUpdate: '9 Jun 2026', assignedTo: 'IT Support', assignedTeam: 'Technical Support',
    messages: 4,
    description: 'When attempting to upload PDF evidence files for Module 4, the upload spinner appears briefly then disappears with no file attached. I have tried Chrome and Firefox on both my work laptop and personal device. The file size is under 10MB. Browser console shows a timeout error after approximately 30 seconds.',
    timeline: [
      { event: 'Opened', timestamp: '8 Jun 2026, 14:22', detail: 'Ticket created by Sophie Williams' },
      { event: 'Assigned', timestamp: '8 Jun 2026, 14:45', detail: 'Assigned to IT Support team' },
      { event: 'In Progress', timestamp: '9 Jun 2026, 09:10', detail: 'IT Support investigating upload endpoint' },
    ],
    replies: [
      { id: 'r-1', sender: 'Sophie Williams', senderRole: 'Learner', body: 'I have tried multiple times and the issue persists. The file is 4MB, not large. I have cleared my cache and tried incognito mode.', timestamp: '8 Jun 2026, 14:25' },
      { id: 'r-2', sender: 'IT Support', senderRole: 'Support', body: 'Thank you for the details. We are investigating the upload endpoint. We suspect it is a timeout configuration on the server side. We will update you shortly.', timestamp: '8 Jun 2026, 15:00' },
      { id: 'r-3', sender: 'IT Support', senderRole: 'Support', body: 'We have identified the issue — a firewall rule was blocking uploads from certain IP ranges. We have whitelisted your network. Please try again and let us know.', timestamp: '9 Jun 2026, 09:15' },
      { id: 'r-4', sender: 'Sophie Williams', senderRole: 'Learner', body: 'Upload works now! Thank you for the quick fix. I was able to upload my evidence files successfully.', timestamp: '9 Jun 2026, 10:00' },
    ],
  },
  {
    id: 'tkt-002', title: 'OTJH hours not showing in monthly summary', category: 'Data', priority: 'medium', status: 'open',
    submitted: '6 Jun 2026', lastUpdate: '6 Jun 2026', assignedTo: 'MIS Team', assignedTeam: 'MIS Operations',
    messages: 1,
    description: 'I have logged 14 hours of OTJH this week across 4 entries, but the monthly summary dashboard shows only 6 hours. Individual entries are visible in the list but the total is not summing correctly. I also noticed that one entry from last Friday is missing entirely.',
    timeline: [
      { event: 'Opened', timestamp: '6 Jun 2026, 09:30', detail: 'Ticket created by Sophie Williams' },
    ],
    replies: [
      { id: 'r-1', sender: 'Sophie Williams', senderRole: 'Learner', body: 'I have checked again this morning and the total is still wrong. The missing entry is from 5 June, 2 hours of workplace project time.', timestamp: '6 Jun 2026, 09:35' },
    ],
  },
  {
    id: 'tkt-003', title: 'Question about evidence linking to multiple KSBs', category: 'Learning Support', priority: 'low', status: 'resolved',
    submitted: '30 May 2026', lastUpdate: '2 Jun 2026', assignedTo: 'Crispin Jones', assignedTeam: 'Tutor Team',
    messages: 3,
    description: 'I have a workplace observation evidence that I believe maps to K5, K6, and S8 simultaneously. Can I link one piece of evidence to multiple KSBs, or do I need separate evidence for each? Also, is there a limit to how many KSBs one evidence item can cover?',
    timeline: [
      { event: 'Opened', timestamp: '30 May 2026, 11:00', detail: 'Ticket created by Sophie Williams' },
      { event: 'Assigned', timestamp: '30 May 2026, 11:30', detail: 'Assigned to Crispin Jones (Tutor)' },
      { event: 'In Progress', timestamp: '30 May 2026, 14:00', detail: 'Tutor reviewing evidence mapping guidelines' },
      { event: 'Learner Reply', timestamp: '1 Jun 2026, 10:15', detail: 'Sophie confirmed understanding' },
      { event: 'Resolved', timestamp: '2 Jun 2026, 16:00', detail: 'Guidance provided — evidence can map to multiple KSBs' },
    ],
    replies: [
      { id: 'r-1', sender: 'Crispin Jones', senderRole: 'Tutor', body: 'Yes, absolutely! One piece of evidence can map to multiple KSBs. There is no hard limit, but we recommend 2-4 KSBs per evidence item for clarity. When you upload evidence, click "Map to KSBs" and select the relevant ones. Add a brief justification note for each.', timestamp: '30 May 2026, 11:45' },
      { id: 'r-2', sender: 'Sophie Williams', senderRole: 'Learner', body: 'Thanks Crispin! That is very helpful. So I can map my observation to K5, K6, and S8 in one go? I will add a justification note for each one.', timestamp: '1 Jun 2026, 10:15' },
      { id: 'r-3', sender: 'Crispin Jones', senderRole: 'Tutor', body: 'Exactly, that sounds like a good plan. Let me know if you need any help with the mapping — I am happy to review once you have submitted it.', timestamp: '2 Jun 2026, 09:30' },
    ],
  },
  {
    id: 'tkt-004', title: 'Teams session recording not available for Week 2', category: 'Technical', priority: 'medium', status: 'resolved',
    submitted: '24 May 2026', lastUpdate: '26 May 2026', assignedTo: 'IT Support', assignedTeam: 'Technical Support',
    messages: 2,
    description: 'The Week 2 Marketing Environment session recording is not appearing in the Module 1 resources tab. Other learners in my cohort have confirmed they also cannot see it. The live session was held on 20 May and usually recordings appear within 24 hours.',
    timeline: [
      { event: 'Opened', timestamp: '24 May 2026, 09:00', detail: 'Ticket created by Sophie Williams' },
      { event: 'Assigned', timestamp: '24 May 2026, 09:45', detail: 'Assigned to IT Support' },
      { event: 'In Progress', timestamp: '24 May 2026, 10:30', detail: 'IT checking recording upload status' },
      { event: 'Resolved', timestamp: '26 May 2026, 14:00', detail: 'Recording re-uploaded and verified' },
      { event: 'Closed', timestamp: '26 May 2026, 16:00', detail: 'Ticket closed after learner confirmation' },
    ],
    replies: [
      { id: 'r-1', sender: 'IT Support', senderRole: 'Support', body: 'Thank you for reporting this. We have checked the recording server and found that the upload was interrupted due to a storage issue. We are re-uploading the recording now. It should be available within 2 hours.', timestamp: '24 May 2026, 11:00' },
      { id: 'r-2', sender: 'Sophie Williams', senderRole: 'Learner', body: 'I can see the recording now. Thank you for the quick turnaround! The audio is clear and the video quality is good.', timestamp: '26 May 2026, 14:30' },
    ],
  },
];

const FAQ_ITEMS = [
  { id: 'faq-01', question: 'How do I log my off-the-job training hours?', answer: 'Go to My OTJH page, click "Add OTJH Entry", fill in the date, activity type, description, hours claimed, and link it to a module and relevant KSBs. Your employer and coach will then validate your entry.' },
  { id: 'faq-02', question: 'What counts as off-the-job training?', answer: 'Off-the-job training is learning undertaken outside your normal day-to-day work duties but during your paid working hours. This includes live sessions, recorded learning, assignment research, workplace projects, coaching meetings, progress review preparation, and structured reflection.' },
  { id: 'faq-03', question: 'How do I report an absence from a live session?', answer: 'Go to Report My Absence, select the session date and title, choose your reason for absence, provide details, and submit. Your coach and tutor will be notified automatically. A recording will be made available for catch-up.' },
  { id: 'faq-04', question: 'How are KSBs validated?', answer: 'KSBs are validated when you submit evidence that demonstrates that Knowledge, Skill, or Behaviour. Your tutor reviews the evidence and links it to relevant KSBs. Once accepted, the KSB status changes to Validated. You need all KSBs validated before Gateway.' },
  { id: 'faq-05', question: 'What happens in a progress review?', answer: 'A progress review is a tripartite meeting involving you, your coach, and your line manager. You discuss your progress against the training plan, review evidence, check OTJH hours, discuss any barriers, and agree actions for the next period. Reviews happen every 4-6 weeks.' },
  { id: 'faq-06', question: 'How do I prepare for my monthly coaching session?', answer: 'Complete the coaching preparation checklist on your Monthly Coaching page. Reflect on your learning since the last session, note any workplace applications, prepare questions about KSBs you are working on, and review your OTJH and evidence progress.' },
  { id: 'faq-07', question: 'What is the Gateway and when does it happen?', answer: 'The Gateway is the formal checkpoint between your on-programme learning and the End-Point Assessment. It happens when you, your employer, and KBC agree you have met all requirements. Your target Gateway date is October 2027.' },
  { id: 'faq-08', question: 'How do I change my coaching meeting time?', answer: 'Contact your coach Med Maher directly via the Messages page or email. If you need to reschedule, provide at least 48 hours\' notice. Urgent changes can be discussed via the Support ticket system.' },
  { id: 'faq-09', question: 'Can I submit evidence from before my apprenticeship started?', answer: 'Evidence should relate to learning and workplace activities during your apprenticeship. Recognition of Prior Learning (RPL) may be considered during your initial assessment — speak to your coach if you have significant prior experience relevant to the KSBs.' },
  { id: 'faq-10', question: 'How do clubs work and how do I earn points?', answer: 'Clubs are learner-led professional communities. You earn points by attending events (50 pts), contributing to discussions (30 pts), sharing resources (40 pts), helping peers (25 pts), and hosting sessions (100 pts). Points contribute to your recognition level and rewards.' },
];

const KB_CATEGORIES = [
  { id: 'kb-evidence', name: 'Evidence & Portfolio', icon: 'ri-folder-upload-line', color: 'bg-primary-100 text-primary-600' },
  { id: 'kb-otjh', name: 'OTJH', icon: 'ri-time-line', color: 'bg-accent-100 text-accent-600' },
  { id: 'kb-ksb', name: 'KSB Mapping', icon: 'ri-bar-chart-2-line', color: 'bg-secondary-100 text-secondary-600' },
  { id: 'kb-coaching', name: 'Coaching', icon: 'ri-chat-smile-2-line', color: 'bg-amber-100 text-amber-600' },
  { id: 'kb-reviews', name: 'Progress Reviews', icon: 'ri-file-chart-line', color: 'bg-emerald-100 text-emerald-600' },
  { id: 'kb-gateway', name: 'Gateway', icon: 'ri-flag-line', color: 'bg-red-100 text-red-600' },
  { id: 'kb-epa', name: 'EPA', icon: 'ri-award-line', color: 'bg-indigo-100 text-indigo-600' },
  { id: 'kb-funding', name: 'Funding', icon: 'ri-money-pound-circle-line', color: 'bg-teal-100 text-teal-600' },
  { id: 'kb-safeguarding', name: 'Safeguarding', icon: 'ri-shield-check-line', color: 'bg-rose-100 text-rose-600' },
  { id: 'kb-tech', name: 'Technical Support', icon: 'ri-computer-line', color: 'bg-slate-100 text-slate-600' },
];

const KB_ARTICLES: KnowledgeArticle[] = [
  { id: 'kb-a01', title: 'How to upload evidence files correctly', category: 'kb-evidence', excerpt: 'Step-by-step guide to uploading PDF, image, and document evidence to your portfolio. Includes file size limits and supported formats.', content: '1. Navigate to Evidence Library. 2. Click "Upload Evidence". 3. Select your file (PDF, PNG, JPG, DOCX, MP4 — max 50MB). 4. Add a title and description. 5. Link to relevant KSBs. 6. Click Submit. Your coach and tutor will be notified. If upload fails, check your internet connection and try a smaller file size.' },
  { id: 'kb-a02', title: 'Linking evidence to multiple KSBs', category: 'kb-ksb', excerpt: 'One piece of evidence can map to multiple KSBs. Learn how to effectively cross-reference evidence with Knowledge, Skills, and Behaviours.', content: 'Yes, one evidence item can map to multiple KSBs. There is no hard limit, but we recommend mapping to 2-4 KSBs maximum per evidence item for clarity. To map: open the evidence, click "Map to KSBs", select the relevant KSBs from the list, and add a brief justification note for each mapping. Your tutor reviews these mappings during validation.' },
  { id: 'kb-a03', title: 'Logging OTJH hours step by step', category: 'kb-otjh', excerpt: 'Complete guide to recording off-the-job training hours, including what counts and how to ensure entries are validated.', content: '1. Go to My OTJH. 2. Click "Add OTJH Entry". 3. Select the date. 4. Choose activity type (Live Session, Self-Study, Assignment, Workplace Project, Coaching, etc.). 5. Write a brief description. 6. Enter hours claimed (use 15-minute increments). 7. Link to a module if applicable. 8. Select relevant KSBs demonstrated. 9. Submit for employer validation.' },
  { id: 'kb-a04', title: 'Preparing for your monthly coaching session', category: 'kb-coaching', excerpt: 'Make the most of your coaching sessions with proper preparation. Checklist and best practices for productive meetings.', content: 'Before each coaching session: 1. Review your training plan progress. 2. Check your OTJH dashboard for any gaps. 3. Prepare 2-3 specific examples of workplace application. 4. Note any barriers or challenges you are facing. 5. Review your evidence portfolio. 6. Prepare questions about upcoming modules or KSBs. During the session: take notes on agreed actions and deadlines.' },
  { id: 'kb-a05', title: 'Understanding progress reviews', category: 'kb-reviews', excerpt: 'What to expect in your tripartite progress reviews with your coach and line manager every 4-6 weeks.', content: 'Progress reviews involve you, your coach, and your line manager. They happen every 4-6 weeks and cover: progress against your training plan, evidence and portfolio review, OTJH hour compliance, KSB progress tracking, identification of barriers and support needs, setting targets for the next period, and your wellbeing check. Come prepared with your training plan open and evidence portfolio ready.' },
  { id: 'kb-a06', title: 'Gateway readiness checklist', category: 'kb-gateway', excerpt: 'Everything you need to know about Gateway — the formal checkpoint before your End-Point Assessment.', content: 'Gateway requirements: 1. All KSBs validated. 2. OTJH minimum hours met (20% of contracted hours). 3. English and maths Level 2 achieved. 4. Portfolio of evidence complete. 5. Employer confirms competence. 6. Progress reviews all completed. 7. No outstanding disciplinary or attendance issues. Your target Gateway date is approximately month 18-20 of your programme.' },
  { id: 'kb-a07', title: 'Understanding your funding and what it covers', category: 'kb-funding', excerpt: 'How apprenticeship funding works, what the levy covers, and what costs you might incur.', content: 'Your apprenticeship is fully funded through the apprenticeship levy. This covers: all training and assessment costs, access to the KBC LearningOS platform, coaching and tutoring support, and End-Point Assessment fees. You do not pay anything towards your apprenticeship. Your employer pays your wages as normal. If you leave your apprenticeship early, you will not be asked to repay any training costs.' },
  { id: 'kb-a08', title: 'Who to contact for safeguarding concerns', category: 'kb-safeguarding', excerpt: 'Safeguarding contacts, how to report concerns, and what happens when you make a report.', content: 'If you have a safeguarding concern about yourself or another learner: contact the Designated Safeguarding Lead at safeguarding@kbc.ac.uk or call 01227 811 250 (24/7). All concerns are treated confidentially. You can also speak to your coach Med Maher in confidence. In an emergency, always call 999 first. The safeguarding team will assess the concern, contact you within 24 hours, and agree next steps.' },
  { id: 'kb-a09', title: 'Troubleshooting common platform issues', category: 'kb-tech', excerpt: 'Quick fixes for common technical problems — clear cache, browser compatibility, and connectivity checks.', content: 'Common fixes: 1. Clear your browser cache (Settings > Privacy > Clear browsing data). 2. Use Chrome or Edge (Firefox has known issues with file uploads). 3. Check your internet connection — minimum 5 Mbps recommended. 4. Disable browser extensions that might interfere. 5. Log out and back in to refresh your session. 6. If using a work device, check if your IT department blocks any required domains.' },
  { id: 'kb-a10', title: 'Preparing for End-Point Assessment (EPA)', category: 'kb-epa', excerpt: 'What to expect from EPA, how to prepare, and the assessment components you will face.', content: 'Your EPA consists of: 1. Professional Discussion (60 min) — based on your portfolio of evidence. 2. Project Presentation (30 min + Q&A) — presenting a workplace project. 3. Knowledge Test (90 min) — multiple choice and short answer. Preparation: start 3 months before EPA, review all KSB criteria, organise your portfolio logically, practice your presentation with your coach, and complete mock tests available in the Question Bank.' },
];

const AI_SUGGESTIONS = [
  { id: 'ai-1', question: 'How do I upload evidence?', answer: 'Go to Evidence Library and click "Upload Evidence". Select your file (max 50MB, supported formats: PDF, PNG, JPG, DOCX, MP4). Fill in the title, description, and link it to relevant KSBs. Then click Submit. Your coach and tutor will be automatically notified. If the upload fails, try clearing your browser cache or using a smaller file size.' },
  { id: 'ai-2', question: 'How do I log OTJH?', answer: 'Navigate to My OTJH from your workspace sidebar. Click "Add OTJH Entry", select the date and activity type, write a description, enter the hours claimed (in 15-minute increments), and link it to a module and relevant KSBs. Submit for employer validation. Remember: OTJH must total at least 20% of your contracted working hours over the programme.' },
  { id: 'ai-3', question: 'How do I prepare for Gateway?', answer: 'Gateway preparation checklist: 1) Ensure all KSBs are validated in your KSB Progress page. 2) Your OTJH hours must meet the minimum target (check My OTJH dashboard). 3) Your portfolio of evidence should be complete and well-organised. 4) Your employer must confirm you are occupationally competent. 5) English and maths Level 2 must be achieved. Speak to your coach Med Maher to schedule a Gateway readiness review.' },
  { id: 'ai-4', question: 'How do I submit a reflection?', answer: 'Go to your Monthly Coaching page. Under the current month section, find "Reflection". Write your reflection (aim for 300-500 words) covering: what you learned recently, how you applied it at work, challenges you faced, and goals for the next period. Link it to relevant KSBs and modules. Your coach will review it before your next coaching session.' },
  { id: 'ai-5', question: 'How do I map KSBs?', answer: 'When you submit evidence, you can map it to relevant KSBs. From the evidence upload form, click "Map to KSBs". A list of all KSBs for your programme will appear. Select the ones your evidence demonstrates and add a brief justification for each. You can map one piece of evidence to multiple KSBs (we recommend 2-4 max). Your tutor reviews these mappings during evidence validation.' },
];

const CONTACT_OPTIONS = [
  { name: 'Med Maher', role: 'Your Coach', email: 'med.maher@kbc.ac.uk', phone: '01227 811 234', icon: 'ri-chat-smile-2-line', availability: 'Mon–Fri, 9am–5pm' },
  { name: 'Crispin Jones', role: 'Your Tutor', email: 'crispin.jones@kbc.ac.uk', phone: '01227 811 235', icon: 'ri-user-settings-line', availability: 'Tue–Thu, 10am–4pm' },
  { name: 'Learner Support', role: 'KBC Support Team', email: 'learnersupport@kbc.ac.uk', phone: '01227 811 200', icon: 'ri-customer-service-2-line', availability: 'Mon–Fri, 8am–6pm' },
  { name: 'IT Helpdesk', role: 'Technical Support', email: 'ithelp@kbc.ac.uk', phone: '01227 811 299', icon: 'ri-computer-line', availability: 'Mon–Fri, 8am–8pm' },
  { name: 'Safeguarding', role: 'Confidential Support', email: 'safeguarding@kbc.ac.uk', phone: '01227 811 250', icon: 'ri-shield-check-line', availability: '24/7 urgent line' },
];

function getSLA(priority: string): string {
  switch (priority) {
    case 'urgent': return 'Within 4 Hours';
    case 'high': return 'Within 24 Hours';
    case 'medium': return 'Within 1 Working Day';
    case 'low': return 'Within 3 Working Days';
    default: return '—';
  }
}

function getSLAColor(priority: string): string {
  switch (priority) {
    case 'urgent': return 'text-red-600 bg-red-50';
    case 'high': return 'text-amber-600 bg-amber-50';
    case 'medium': return 'text-blue-600 bg-blue-50';
    case 'low': return 'text-foreground-400 bg-background-100';
    default: return 'text-foreground-400 bg-background-100';
  }
}

export default function SupportPage() {
  const p = LEARNER_PROFILE;
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>('tickets');
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);

  const [newTicketCategory, setNewTicketCategory] = useState<string>('Technical Issue');
  const [newTicketSubject, setNewTicketSubject] = useState('');
  const [newTicketDescription, setNewTicketDescription] = useState('');
  const [newTicketPriority, setNewTicketPriority] = useState('Medium — Needs attention this week');
  const [aiQuery, setAiQuery] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiAnswering, setAiAnswering] = useState(false);

  // Auto-open ticket modal from URL params
  useEffect(() => {
    const action = searchParams.get('action');
    const category = searchParams.get('category');
    if (action === 'new-ticket') {
      setActiveTab('tickets');
      if (category) {
        const categoryMap: Record<string, string> = {
          wellbeing: 'Safeguarding Concern',
          technical: 'Technical Issue',
          learning: 'Learning Support',
          data: 'Data / MIS',
          coaching: 'Coaching Query',
        };
        setNewTicketCategory(categoryMap[category] || 'Safeguarding Concern');
      }
      setTimeout(() => setTicketModalOpen(true), 100);
    }
  }, [searchParams]);

  // Knowledge Base
  const [kbCategory, setKbCategory] = useState<string | null>(null);
  const [kbSearch, setKbSearch] = useState('');
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  // Resolution feedback with rating + comment
  const [feedbackRating, setFeedbackRating] = useState<Record<string, number>>({});
  const [feedbackComment, setFeedbackComment] = useState<Record<string, string>>({});
  const [feedbackSubmitting, setFeedbackSubmitting] = useState<Record<string, boolean>>({});
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Record<string, boolean>>({});

  // Ticket Replies
  const [ticketReplies, setTicketReplies] = useState<Record<string, TicketReply[]>>(
    TICKETS.reduce((acc, t) => ({ ...acc, [t.id]: t.replies || [] }), {})
  );
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replySending, setReplySending] = useState(false);

  // Contact Modals
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState({ name: '', email: '' });
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callContact, setCallContact] = useState({ name: '', phone: '' });
  const [callActive, setCallActive] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callTimer, setCallTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  // Report Concern Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportConcern, setReportConcern] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);

  const openTickets = TICKETS.filter(t => t.status === 'open' || t.status === 'in-progress').length;

  const handleAiAsk = (question: string) => {
    setAiQuery(question);
    setAiAnswering(true);
    setAiAnswer(null);
    const suggestion = AI_SUGGESTIONS.find(s => s.question === question);
    setTimeout(() => {
      setAiAnswer(suggestion ? suggestion.answer : 'I could not find a specific answer for that question. Please try submitting a support ticket and our team will help you.');
      setAiAnswering(false);
    }, 1500);
  };

  const handleAiSearch = () => {
    if (!aiQuery.trim()) return;
    handleAiAsk(aiQuery.trim());
  };

  const handleSendReply = () => {
    if (!selectedTicket || !replyBody.trim()) return;
    setReplySending(true);
    setTimeout(() => {
      const newReply: TicketReply = {
        id: `r-${Date.now()}`,
        sender: 'Sophie Williams',
        senderRole: 'Learner',
        body: replyBody.trim(),
        timestamp: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      };
      setTicketReplies(prev => ({
        ...prev,
        [selectedTicket.id]: [...(prev[selectedTicket.id] || []), newReply],
      }));
      setReplyBody('');
      setReplySending(false);
      setReplyModalOpen(false);
    }, 1200);
  };

  const handleOpenEmail = (name: string, email: string) => {
    setEmailTo({ name, email });
    setEmailSubject('');
    setEmailBody('');
    setEmailSending(false);
    setEmailModalOpen(true);
  };

  const handleSendEmail = () => {
    if (!emailSubject.trim() || !emailBody.trim()) return;
    setEmailSending(true);
    setTimeout(() => {
      setEmailSending(false);
      setEmailModalOpen(false);
    }, 1500);
  };

  const handleOpenCall = (name: string, phone: string) => {
    setCallContact({ name, phone });
    setCallActive(false);
    setCallDuration(0);
    setCallModalOpen(true);
  };

  const handleStartCall = () => {
    setCallActive(true);
    const timer = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    setCallTimer(timer);
  };

  const handleEndCall = () => {
    if (callTimer) {
      clearInterval(callTimer);
      setCallTimer(null);
    }
    setCallActive(false);
    setCallDuration(0);
    setCallModalOpen(false);
  };

  const handleSubmitReport = () => {
    if (!reportConcern.trim()) return;
    setReportSubmitting(true);
    setTimeout(() => {
      setReportSubmitting(false);
      setReportSubmitted(true);
      setTimeout(() => {
        setReportModalOpen(false);
        setReportSubmitted(false);
        setReportConcern('');
        setReportDetails('');
      }, 2000);
    }, 1500);
  };

  const handleFeedbackSubmit = (ticketId: string) => {
    setFeedbackSubmitting(prev => ({ ...prev, [ticketId]: true }));
    setTimeout(() => {
      setFeedbackSubmitting(prev => ({ ...prev, [ticketId]: false }));
      setFeedbackSubmitted(prev => ({ ...prev, [ticketId]: true }));
    }, 1200);
  };

  const filteredKB = KB_ARTICLES.filter(a => {
    const matchCat = !kbCategory || a.category === kbCategory;
    const matchSearch = !kbSearch || a.title.toLowerCase().includes(kbSearch.toLowerCase()) || a.excerpt.toLowerCase().includes(kbSearch.toLowerCase());
    return matchCat && matchSearch;
  });

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Support Hub" pageSubtitle="AI-assisted support, knowledge base, tickets, and contact"
      userName={p.fullName} userRole={`${p.programme} ${p.programmeLevel} Apprentice`}
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-customer-service-2-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">How can we help, {p.firstName}?</h2>
              <p className="text-sm text-white/80 leading-relaxed max-w-2xl">
                Our support team is here to help with any questions about your apprenticeship. You have <strong>{openTickets} open ticket{openTickets !== 1 ? 's' : ''}</strong>.
                For urgent matters, call KBC Learner Support on 01227 811 200.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setAiModalOpen(true)}
                className="px-4 py-2.5 bg-white/10 border border-white/20 text-white rounded-xl text-sm font-semibold hover:bg-white/20 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 backdrop-blur-sm"
              >
                <i className="ri-robot-line"></i> Ask AI
              </button>
              <button
                onClick={() => setTicketModalOpen(true)}
                className="px-4 py-2.5 bg-white text-primary-700 rounded-xl text-sm font-semibold hover:bg-white/90 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2"
              >
                <i className="ri-add-line"></i> New Ticket
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'tickets' as TabKey, label: 'My Tickets', icon: 'ri-ticket-line', badge: openTickets },
            { key: 'faq' as TabKey, label: 'FAQ', icon: 'ri-question-answer-line' },
            { key: 'knowledge' as TabKey, label: 'Knowledge Base', icon: 'ri-book-read-line' },
            { key: 'contact' as TabKey, label: 'Contact Us', icon: 'ri-phone-line' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <i className={`${tab.icon} text-sm`}></i>
              {tab.label}
              {tab.badge && tab.badge > 0 && (
                <span className="bg-primary-500 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* My Tickets Tab */}
        {activeTab === 'tickets' && (
          <section className="space-y-6">
            {/* Ticket Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Open', value: TICKETS.filter(t => t.status === 'open').length, color: 'bg-amber-50 text-amber-700 border-amber-200' },
                { label: 'In Progress', value: TICKETS.filter(t => t.status === 'in-progress').length, color: 'bg-primary-50 text-primary-700 border-primary-200' },
                { label: 'Resolved', value: TICKETS.filter(t => t.status === 'resolved').length, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                { label: 'Total', value: TICKETS.length, color: 'bg-background-100 text-foreground-500 border-background-200' },
              ].map(stat => (
                <div key={stat.label} className={`rounded-xl border p-3.5 ${stat.color}`}>
                  <p className="text-xs opacity-80 mb-0.5">{stat.label}</p>
                  <p className="text-xl font-bold">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Tickets List + Detail */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
              {/* Tickets List */}
              <div className="lg:col-span-2 space-y-2">
                {TICKETS.map(ticket => (
                  <div
                    key={ticket.id}
                    onClick={() => setSelectedTicket(selectedTicket?.id === ticket.id ? null : ticket)}
                    className={`rounded-xl border p-4 cursor-pointer transition-smooth ${
                      selectedTicket?.id === ticket.id ? 'border-primary-300 bg-primary-50/30 ring-1 ring-primary-200/50' : 'bg-background-50 border-background-200/50 hover:border-background-300/60'
                    } ${ticket.priority === 'urgent' ? 'border-l-[3px] border-l-red-500' : ticket.priority === 'high' ? 'border-l-[3px] border-l-amber-500' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        ticket.priority === 'urgent' ? 'bg-red-500 animate-pulse' : ticket.priority === 'high' ? 'bg-amber-500' : ticket.priority === 'medium' ? 'bg-blue-400' : 'bg-foreground-300'
                      }`}></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold text-foreground-800">{ticket.title}</p>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                            ticket.priority === 'urgent' ? 'bg-red-100 text-red-700' : ticket.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'
                          }`}>{ticket.priority}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] text-foreground-400">#{ticket.id}</span>
                          <span className="text-[10px] text-foreground-300">·</span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{ticket.category}</span>
                          <span className="text-[10px] text-foreground-300 ml-auto">{ticket.submitted}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${
                            ticket.status === 'open' ? 'bg-amber-50 text-amber-700 border-amber-200/50' :
                            ticket.status === 'in-progress' ? 'bg-primary-50 text-primary-700 border-primary-200/50' :
                            ticket.status === 'resolved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' :
                            'bg-background-100 text-foreground-400 border-background-200/50'
                          }`}>{ticket.status === 'in-progress' ? 'In Progress' : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}</span>
                          <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${getSLAColor(ticket.priority)}`}>
                            <i className="ri-time-line text-[8px] mr-1"></i>{getSLA(ticket.priority)}
                          </span>
                          <span className="text-[10px] text-foreground-400">{ticket.messages} msg</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Ticket Detail Panel */}
              <div>
                {selectedTicket ? (
                  <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 md:p-5 sticky top-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-heading font-semibold text-foreground-900">#{selectedTicket.id}</h3>
                      <button
                        onClick={() => setSelectedTicket(null)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                      >
                        <i className="ri-close-line text-xs"></i>
                      </button>
                    </div>

                    <p className="text-[13px] font-semibold text-foreground-800">{selectedTicket.title}</p>

                    {/* Ticket Details Grid */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] bg-background-100/70 rounded-lg p-3">
                      <div><span className="text-foreground-400">Category:</span> <span className="text-foreground-700 font-medium">{selectedTicket.category}</span></div>
                      <div><span className="text-foreground-400">Team:</span> <span className="text-foreground-700 font-medium">{selectedTicket.assignedTeam}</span></div>
                      <div><span className="text-foreground-400">Priority:</span> <span className="font-semibold text-foreground-700">{selectedTicket.priority}</span></div>
                      <div><span className="text-foreground-400">Assigned:</span> <span className="text-foreground-700">{selectedTicket.assignedTo}</span></div>
                      <div><span className="text-foreground-400">Created:</span> <span className="text-foreground-700">{selectedTicket.submitted}</span></div>
                      <div><span className="text-foreground-400">Expected:</span> <span className="text-foreground-700">{getSLA(selectedTicket.priority)}</span></div>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-foreground-400">Status:</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        selectedTicket.status === 'open' ? 'bg-amber-100 text-amber-700' :
                        selectedTicket.status === 'in-progress' ? 'bg-primary-100 text-primary-700' :
                        selectedTicket.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-background-100 text-foreground-400'
                      }`}>{selectedTicket.status === 'in-progress' ? 'In Progress' : selectedTicket.status.charAt(0).toUpperCase() + selectedTicket.status.slice(1)}</span>
                    </div>

                    {/* Description */}
                    <div className="bg-background-100/70 rounded-lg p-3">
                      <p className="text-[12px] text-foreground-600 leading-relaxed">{selectedTicket.description}</p>
                    </div>

                    {/* Timeline */}
                    <div>
                      <h4 className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-3">Ticket Timeline</h4>
                      <div className="space-y-0">
                        {selectedTicket.timeline.map((step, i) => (
                          <div key={i} className="flex gap-3">
                            <div className="flex flex-col items-center shrink-0">
                              <div className={`w-2.5 h-2.5 rounded-full ${
                                step.event === 'Resolved' || step.event === 'Closed' ? 'bg-emerald-400' :
                                step.event === 'Opened' ? 'bg-foreground-300' :
                                'bg-primary-400'
                              }`}></div>
                              {i < selectedTicket.timeline.length - 1 && (
                                <div className="w-0.5 flex-1 bg-background-200 min-h-[20px]"></div>
                              )}
                            </div>
                            <div className={`pb-3 ${i === selectedTicket.timeline.length - 1 ? '' : ''}`}>
                              <p className="text-[11px] font-semibold text-foreground-700">{step.event}</p>
                              <p className="text-[10px] text-foreground-400">{step.timestamp}</p>
                              {step.detail && <p className="text-[10px] text-foreground-500 mt-0.5">{step.detail}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Resolution Feedback (for resolved tickets) */}
                    {(selectedTicket.status === 'resolved' || selectedTicket.status === 'closed') && (
                      <div className="bg-emerald-50/60 rounded-lg p-3 border border-emerald-100/50">
                        {!feedbackSubmitted?.[selectedTicket.id] ? (
                          <>
                            <p className="text-[11px] font-semibold text-emerald-700 mb-2">Rate your support experience</p>
                            {/* Star Rating */}
                            <div className="flex items-center gap-1 mb-3">
                              {[1, 2, 3, 4, 5].map(star => (
                                <button
                                  key={star}
                                  onClick={() => setFeedbackRating(prev => ({ ...prev, [selectedTicket.id]: star }))}
                                  className="transition-smooth cursor-pointer"
                                >
                                  <i className={`${(feedbackRating?.[selectedTicket.id] || 0) >= star ? 'ri-star-fill text-amber-500' : 'ri-star-line text-foreground-300'} text-base`}></i>
                                </button>
                              ))}
                              <span className="text-[10px] text-foreground-400 ml-1">
                                {feedbackRating?.[selectedTicket.id] ? `${feedbackRating[selectedTicket.id]} / 5` : ''}
                              </span>
                            </div>
                            {/* Comment */}
                            <textarea
                              rows={2}
                              placeholder="Add a comment about the support you received..."
                              value={feedbackComment?.[selectedTicket.id] || ''}
                              onChange={e => setFeedbackComment(prev => ({ ...prev, [selectedTicket.id]: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-xs text-foreground-700 placeholder:text-foreground-300 outline-none focus:border-emerald-400 transition-smooth resize-none mb-2"
                            />
                            <button
                              onClick={() => handleFeedbackSubmit(selectedTicket.id)}
                              disabled={!feedbackRating?.[selectedTicket.id] || feedbackSubmitting?.[selectedTicket.id]}
                              className={`w-full px-3 py-2 rounded-lg text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                                feedbackRating?.[selectedTicket.id] && !feedbackSubmitting?.[selectedTicket.id]
                                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                                  : 'bg-emerald-200 text-emerald-400 cursor-not-allowed'
                              }`}
                            >
                              {feedbackSubmitting?.[selectedTicket.id] ? (
                                <span className="flex items-center justify-center gap-2">
                                  <i className="ri-loader-4-line animate-spin"></i> Submitting...
                                </span>
                              ) : (
                                <span className="flex items-center justify-center gap-2">
                                  <i className="ri-send-plane-line"></i> Submit Feedback
                                </span>
                              )}
                            </button>
                          </>
                        ) : (
                          <div className="text-center py-2">
                            <i className="ri-check-double-line text-emerald-500 text-xl mb-1"></i>
                            <p className="text-xs font-semibold text-emerald-700">Thank you for your feedback!</p>
                            <p className="text-[10px] text-emerald-600 mt-0.5">Your feedback helps us improve our support.</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Replies Thread */}
                    {selectedTicket && (ticketReplies[selectedTicket.id] || []).length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wide mb-3">Replies</h4>
                        <div className="space-y-2">
                          {(ticketReplies[selectedTicket.id] || []).map(reply => (
                            <div key={reply.id} className={`rounded-lg p-3 text-[11px] ${
                              reply.senderRole === 'Learner' ? 'bg-primary-50/40 border border-primary-100/30' : 'bg-background-100 border border-background-200/50'
                            }`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-foreground-700">{reply.sender}</span>
                                <span className="text-[9px] text-foreground-400">{reply.timestamp}</span>
                              </div>
                              <p className="text-foreground-600 leading-relaxed">{reply.body}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reply action */}
                    <button
                      onClick={() => setReplyModalOpen(true)}
                      className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
                    >
                      <i className="ri-reply-line"></i> Reply to Ticket
                    </button>
                  </div>
                ) : (
                  <div className="bg-background-50 rounded-xl border border-background-200/50 p-6 text-center">
                    <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                      <i className="ri-ticket-line text-foreground-300 text-xl"></i>
                    </div>
                    <p className="text-[13px] text-foreground-500">Select a ticket to view details</p>
                    <p className="text-[11px] text-foreground-300 mt-1">View timeline, details, and feedback</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* FAQ Tab */}
        {activeTab === 'faq' && (
          <section>
            <div className="mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Frequently Asked Questions</h3>
              <p className="text-xs text-foreground-400 mt-0.5">Quick answers to the most common apprenticeship questions</p>
            </div>
            <div className="space-y-2">
              {FAQ_ITEMS.map(faq => (
                <div key={faq.id} className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === faq.id ? null : faq.id)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-background-100/50 transition-smooth cursor-pointer"
                  >
                    <span className="text-sm font-medium text-foreground-900 pr-4">{faq.question}</span>
                    <i className={`${expandedFaq === faq.id ? 'ri-subtract-line' : 'ri-add-line'} text-foreground-400 shrink-0`}></i>
                  </button>
                  {expandedFaq === faq.id && (
                    <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
                      <p className="text-sm text-foreground-600 leading-relaxed">{faq.answer}</p>
                      <p className="text-xs text-foreground-300 mt-2">Was this helpful? <button className="text-primary-600 hover:text-primary-700 font-medium cursor-pointer ml-1">Yes</button> <span className="mx-1 text-foreground-200">|</span> <button className="text-primary-600 hover:text-primary-700 font-medium cursor-pointer">No — I need more help</button></p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Knowledge Base Tab */}
        {activeTab === 'knowledge' && (
          <section className="space-y-5">
            <div className="mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Knowledge Base</h3>
              <p className="text-xs text-foreground-400 mt-0.5">Browse articles organised by topic to find answers</p>
            </div>

            {/* KB Search */}
            <div className="relative">
              <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
              <input
                type="text"
                placeholder="Search knowledge base articles..."
                value={kbSearch}
                onChange={e => setKbSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth"
              />
            </div>

            {/* KB Categories */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              <button
                onClick={() => setKbCategory(null)}
                className={`rounded-xl border p-3 text-center transition-smooth cursor-pointer ${
                  !kbCategory ? 'border-primary-300 bg-primary-50/50 ring-1 ring-primary-200/50' : 'bg-background-50 border-background-200/50 hover:border-background-300/60'
                }`}
              >
                <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center mx-auto mb-1.5">
                  <i className="ri-apps-line text-foreground-400 text-sm"></i>
                </span>
                <p className="text-[11px] font-medium text-foreground-600">All Topics</p>
              </button>
              {KB_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setKbCategory(kbCategory === cat.id ? null : cat.id)}
                  className={`rounded-xl border p-3 text-center transition-smooth cursor-pointer ${
                    kbCategory === cat.id ? 'border-primary-300 bg-primary-50/50 ring-1 ring-primary-200/50' : 'bg-background-50 border-background-200/50 hover:border-background-300/60'
                  }`}
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5 ${cat.color}`}>
                    <i className={`${cat.icon} text-sm`}></i>
                  </span>
                  <p className="text-[11px] font-medium text-foreground-600 leading-tight">{cat.name}</p>
                </button>
              ))}
            </div>

            {/* KB Articles */}
            <div className="space-y-2">
              {filteredKB.map(article => (
                <div key={article.id} className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
                  <button
                    onClick={() => setExpandedArticle(expandedArticle === article.id ? null : article.id)}
                    className="w-full flex items-start gap-3 p-4 text-left hover:bg-background-100/50 transition-smooth cursor-pointer"
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${KB_CATEGORIES.find(c => c.id === article.category)?.color || 'bg-background-100'}`}>
                      <i className={`${KB_CATEGORIES.find(c => c.id === article.category)?.icon || 'ri-file-text-line'} text-sm`}></i>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-800">{article.title}</p>
                      <p className="text-[11px] text-foreground-400 mt-0.5 line-clamp-2 leading-relaxed">{article.excerpt}</p>
                    </div>
                    <i className={`${expandedArticle === article.id ? 'ri-subtract-line' : 'ri-add-line'} text-foreground-400 shrink-0 mt-1`}></i>
                  </button>
                  {expandedArticle === article.id && (
                    <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
                      <p className="text-sm text-foreground-600 leading-relaxed">{article.content}</p>
                      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-background-100">
                        <button className="text-xs text-primary-600 hover:text-primary-700 font-medium cursor-pointer flex items-center gap-1">
                          <i className="ri-thumb-up-line"></i> Helpful
                        </button>
                        <button className="text-xs text-foreground-400 hover:text-foreground-600 font-medium cursor-pointer flex items-center gap-1">
                          <i className="ri-thumb-down-line"></i> Not helpful
                        </button>
                        <span className="text-xs text-foreground-300 ml-auto">Still need help? <button onClick={() => { setTicketModalOpen(true); }} className="text-primary-600 font-medium cursor-pointer">Create a ticket</button></span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {filteredKB.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <i className="ri-book-open-line text-2xl text-foreground-200 mb-2"></i>
                  <p className="text-sm text-foreground-400">No articles match your search</p>
                  <p className="text-xs text-foreground-300 mt-1">Try a different keyword or browse all topics</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Contact Us Tab */}
        {activeTab === 'contact' && (
          <section className="space-y-6">
            <div className="mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Contact the Support Team</h3>
              <p className="text-xs text-foreground-400 mt-0.5">Reach out directly — we are here to help</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CONTACT_OPTIONS.map(contact => (
                <div key={contact.name} className="bg-background-50 rounded-xl border border-background-200/50 p-5 text-center">
                  <span className="w-12 h-12 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-3">
                    <i className={`${contact.icon} text-lg`}></i>
                  </span>
                  <h4 className="text-sm font-semibold text-foreground-900">{contact.name}</h4>
                  <p className="text-xs text-foreground-400 mb-3">{contact.role}</p>
                  <div className="space-y-1.5 mb-4 text-left">
                    <p className="text-xs text-foreground-500 flex items-center gap-1.5">
                      <i className="ri-mail-line text-xs text-foreground-300"></i> {contact.email}
                    </p>
                    <p className="text-xs text-foreground-500 flex items-center gap-1.5">
                      <i className="ri-phone-line text-xs text-foreground-300"></i> {contact.phone}
                    </p>
                    <p className="text-xs text-foreground-400 flex items-center gap-1.5">
                      <i className="ri-time-line text-xs text-foreground-300"></i> {contact.availability}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenEmail(contact.name, contact.email)}
                      className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-mail-send-line mr-1"></i> Email
                    </button>
                    <button
                      onClick={() => handleOpenCall(contact.name, contact.phone)}
                      className="flex-1 px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-xs font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-phone-line mr-1"></i> Call
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Urgent Support Banner */}
            <div className="bg-red-50 border border-red-200/50 rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <span className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <i className="ri-alert-fill text-red-600 text-xl"></i>
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">Urgent Safeguarding or Wellbeing Concern?</p>
                <p className="text-sm text-red-600 mt-0.5 leading-relaxed">
                  If you or someone you know is at immediate risk, call <strong>999</strong>. For non-emergency safeguarding concerns, contact our designated safeguarding lead on <strong>01227 811 250</strong> (available 24/7) or email <strong>safeguarding@kbc.ac.uk</strong>. All concerns are treated confidentially.
                </p>
              </div>
              <button
                onClick={() => setReportModalOpen(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <i className="ri-shield-check-line mr-1"></i> Report Concern
              </button>
            </div>
          </section>
        )}

        {/* AI Support Modal */}
        {aiModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setAiModalOpen(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-xl mx-4 shadow-2xl border border-background-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300 max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-background-200/50">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center">
                    <i className="ri-robot-line text-primary-600 text-lg"></i>
                  </span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Ask AI First</h3>
                    <p className="text-xs text-foreground-400">Get instant answers before creating a support ticket</p>
                  </div>
                </div>
                <button onClick={() => setAiModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-sm"></i>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* AI Search */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-300 text-base"></i>
                    <input
                      type="text"
                      placeholder="Ask a question..."
                      value={aiQuery}
                      onChange={e => setAiQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAiSearch(); }}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth"
                    />
                  </div>
                  <button
                    onClick={handleAiSearch}
                    disabled={!aiQuery.trim()}
                    className={`px-4 py-3 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                      aiQuery.trim() ? 'bg-primary-500 text-white hover:bg-primary-600' : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                    }`}
                  >
                    <i className="ri-arrow-right-line"></i>
                  </button>
                </div>

                {/* AI Answer */}
                {aiAnswering && (
                  <div className="bg-primary-50/50 rounded-xl p-4 border border-primary-100/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {[0, 1, 2].map(i => (
                          <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}></div>
                        ))}
                      </div>
                      <span className="text-xs text-primary-600 font-medium">Thinking...</span>
                    </div>
                  </div>
                )}
                {aiAnswer && !aiAnswering && (
                  <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-100/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-start gap-3">
                      <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                        <i className="ri-check-line text-emerald-600 text-sm"></i>
                      </span>
                      <div className="flex-1">
                        <p className="text-sm text-foreground-700 leading-relaxed">{aiAnswer}</p>
                        <p className="text-xs text-foreground-400 mt-2">Was this helpful? You can still create a ticket if you need more assistance.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Suggested questions */}
                <div>
                  <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide mb-2">Suggested questions</p>
                  <div className="flex flex-wrap gap-2">
                    {AI_SUGGESTIONS.map(s => (
                      <button
                        key={s.id}
                        onClick={() => handleAiAsk(s.question)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                          aiQuery === s.question
                            ? 'bg-primary-500 text-white'
                            : 'bg-background-100 text-foreground-600 hover:bg-background-200 hover:text-foreground-800'
                        }`}
                      >
                        {s.question}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-background-200/50 flex items-center justify-between bg-background-100/50">
                <p className="text-xs text-foreground-400">Not finding what you need?</p>
                <button
                  onClick={() => { setAiModalOpen(false); setTicketModalOpen(true); }}
                  className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2"
                >
                  <i className="ri-add-line"></i> Create Ticket
                </button>
              </div>
            </div>
          </div>
        )}

        {/* New Ticket Modal */}
        {ticketModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setTicketModalOpen(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-lg mx-4 shadow-2xl border border-background-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between px-6 py-4 border-b border-background-200/50">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Submit a New Support Ticket</h3>
                <button onClick={() => setTicketModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-sm"></i>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-foreground-500 mb-1 block">Category</label>
                    <select
                      value={newTicketCategory}
                      onChange={e => setNewTicketCategory(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth cursor-pointer"
                    >
                      <option>Technical Issue</option>
                      <option>Learning Support</option>
                      <option>Data / MIS</option>
                      <option>Coaching Query</option>
                      <option>Safeguarding Concern</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground-500 mb-1 block">Priority</label>
                    <select
                      value={newTicketPriority}
                      onChange={e => setNewTicketPriority(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth cursor-pointer"
                    >
                      <option>Low — Not urgent</option>
                      <option>Medium — Needs attention this week</option>
                      <option>High — Affecting my learning</option>
                      <option>Urgent — Critical issue</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 mb-1 block">Subject</label>
                  <input
                    type="text"
                    value={newTicketSubject}
                    onChange={e => setNewTicketSubject(e.target.value)}
                    placeholder="Brief description of your issue..."
                    className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 mb-1 block">Description</label>
                  <textarea
                    rows={4}
                    value={newTicketDescription}
                    onChange={e => setNewTicketDescription(e.target.value)}
                    placeholder="Please describe your issue in detail..."
                    className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth resize-none"
                  ></textarea>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={() => setTicketModalOpen(false)} className="flex-1 px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    Cancel
                  </button>
                  <button className="flex-1 px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-send-plane-line mr-1"></i> Submit Ticket
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reply Modal */}
        {replyModalOpen && selectedTicket && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setReplyModalOpen(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-lg mx-4 shadow-2xl border border-background-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between px-6 py-4 border-b border-background-200/50">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Reply to #{selectedTicket.id}</h3>
                <button onClick={() => setReplyModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-sm"></i>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-background-100/70 rounded-lg p-3">
                  <p className="text-[12px] text-foreground-500 font-medium mb-1">Re: {selectedTicket.title}</p>
                  <p className="text-[11px] text-foreground-400">{selectedTicket.description}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 mb-1 block">Your reply</label>
                  <textarea
                    rows={4}
                    value={replyBody}
                    onChange={e => setReplyBody(e.target.value)}
                    placeholder="Type your reply here..."
                    className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth resize-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={() => setReplyModalOpen(false)} className="flex-1 px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    Cancel
                  </button>
                  <button
                    onClick={handleSendReply}
                    disabled={!replyBody.trim() || replySending}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                      replyBody.trim() && !replySending
                        ? 'bg-primary-500 text-white hover:bg-primary-600'
                        : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                    }`}
                  >
                    {replySending ? (
                      <span className="flex items-center justify-center gap-2">
                        <i className="ri-loader-4-line animate-spin"></i> Sending...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <i className="ri-send-plane-line mr-1"></i> Send Reply
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Email Modal */}
        {emailModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setEmailModalOpen(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-lg mx-4 shadow-2xl border border-background-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between px-6 py-4 border-b border-background-200/50">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Send Email</h3>
                <button onClick={() => setEmailModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-sm"></i>
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-medium text-foreground-500 mb-1 block">To</label>
                  <div className="px-3 py-2.5 rounded-lg border border-background-200 bg-background-100 text-sm text-foreground-700">
                    {emailTo.name} &lt;{emailTo.email}&gt;
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 mb-1 block">Subject</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={e => setEmailSubject(e.target.value)}
                    placeholder="Enter subject..."
                    className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground-500 mb-1 block">Message</label>
                  <textarea
                    rows={4}
                    value={emailBody}
                    onChange={e => setEmailBody(e.target.value)}
                    placeholder="Write your message..."
                    className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-primary-300 transition-smooth resize-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={() => setEmailModalOpen(false)} className="flex-1 px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    Cancel
                  </button>
                  <button
                    onClick={handleSendEmail}
                    disabled={!emailSubject.trim() || !emailBody.trim() || emailSending}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                      emailSubject.trim() && emailBody.trim() && !emailSending
                        ? 'bg-primary-500 text-white hover:bg-primary-600'
                        : 'bg-background-100 text-foreground-300 cursor-not-allowed'
                    }`}
                  >
                    {emailSending ? (
                      <span className="flex items-center justify-center gap-2">
                        <i className="ri-loader-4-line animate-spin"></i> Sending...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <i className="ri-send-plane-line mr-1"></i> Send Email
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Call Modal */}
        {callModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => handleEndCall()}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-sm mx-4 shadow-2xl border border-background-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between px-6 py-4 border-b border-background-200/50">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Call {callContact.name}</h3>
                <button onClick={handleEndCall} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-sm"></i>
                </button>
              </div>
              <div className="p-6 flex flex-col items-center text-center">
                <span className="w-16 h-16 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center mb-4">
                  <i className="ri-phone-line text-2xl"></i>
                </span>
                <p className="text-sm font-semibold text-foreground-900">{callContact.name}</p>
                <p className="text-xs text-foreground-400 mb-4">{callContact.phone}</p>
                {callActive ? (
                  <>
                    <p className="text-2xl font-mono font-semibold text-foreground-700 mb-4">{formatDuration(callDuration)}</p>
                    <button
                      onClick={handleEndCall}
                      className="px-6 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2"
                    >
                      <i className="ri-close-line"></i> End Call
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStartCall}
                    className="px-6 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2"
                  >
                    <i className="ri-phone-line"></i> Start Call
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Report Concern Modal */}
        {reportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setReportModalOpen(false)}></div>
            <div className="relative bg-background-50 rounded-2xl w-full max-w-lg mx-4 shadow-2xl border border-red-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between px-6 py-4 border-b border-red-100/50 bg-red-50/50">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                    <i className="ri-shield-check-line text-red-600 text-sm"></i>
                  </span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Report a Concern</h3>
                    <p className="text-xs text-foreground-400">All concerns are treated confidentially</p>
                  </div>
                </div>
                <button onClick={() => setReportModalOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer">
                  <i className="ri-close-line text-sm"></i>
                </button>
              </div>
              <div className="p-6 space-y-4">
                {reportSubmitted ? (
                  <div className="text-center py-6">
                    <i className="ri-check-double-line text-emerald-500 text-3xl mb-2"></i>
                    <p className="text-sm font-semibold text-emerald-700">Concern submitted</p>
                    <p className="text-xs text-emerald-600 mt-1">The safeguarding team will contact you within 24 hours. If you are in immediate danger, call 999.</p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-xs font-medium text-foreground-500 mb-1 block">Nature of concern</label>
                      <select
                        value={reportConcern}
                        onChange={e => setReportConcern(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-red-300 transition-smooth cursor-pointer"
                      >
                        <option value="">Select a concern type</option>
                        <option value="bullying">Bullying or harassment</option>
                        <option value="wellbeing">Mental health or wellbeing</option>
                        <option value="abuse">Abuse or neglect</option>
                        <option value="discrimination">Discrimination</option>
                        <option value="self-harm">Self-harm or suicidal thoughts</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-foreground-500 mb-1 block">Details (optional)</label>
                      <textarea
                        rows={4}
                        value={reportDetails}
                        onChange={e => setReportDetails(e.target.value)}
                        placeholder="Describe the situation in as much detail as you are comfortable sharing..."
                        className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-sm text-foreground-700 outline-none focus:border-red-300 transition-smooth resize-none"
                      />
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-xs text-red-700">
                      <i className="ri-alert-line mr-1"></i> In an emergency, always call <strong>999</strong> first.
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                      <button onClick={() => setReportModalOpen(false)} className="flex-1 px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        Cancel
                      </button>
                      <button
                        onClick={handleSubmitReport}
                        disabled={!reportConcern.trim() || reportSubmitting}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap ${
                          reportConcern.trim() && !reportSubmitting
                            ? 'bg-red-600 text-white hover:bg-red-700'
                            : 'bg-red-200 text-red-400 cursor-not-allowed'
                        }`}
                      >
                        {reportSubmitting ? (
                          <span className="flex items-center justify-center gap-2">
                            <i className="ri-loader-4-line animate-spin"></i> Submitting...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            <i className="ri-shield-check-line mr-1"></i> Submit Report
                          </span>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </WorkspaceShell>
  );
}
