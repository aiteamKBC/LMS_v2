// Role-specific recent messages for workspace sidebar widgets
export const roleMessages: Record<string, Array<{ id: string; senderName: string; senderInitials: string; senderColor: string; subject: string; preview: string; time: string; unread: boolean }>> = {
  learner: [
    { id: 'lm-1', senderName: 'Martin Reeves', senderInitials: 'MR', senderColor: 'bg-primary-100 text-primary-700', subject: 'Monthly Check-in Preparation', preview: 'Hi Sarah, I\'ve reviewed your latest evidence...', time: '2h ago', unread: true },
    { id: 'lm-2', senderName: 'Helen Curtis', senderInitials: 'HC', senderColor: 'bg-accent-100 text-accent-700', subject: 'Assignment feedback ready', preview: 'Your Module 7 assignment has been mark...', time: '5h ago', unread: true },
    { id: 'lm-3', senderName: 'Mark Davies', senderInitials: 'MD', senderColor: 'bg-secondary-100 text-secondary-700', subject: 'Employer Review Scheduling', preview: 'Would next Thursday work for the quarter...', time: 'Yesterday', unread: false },
    { id: 'lm-4', senderName: 'Sophie Williams', senderInitials: 'SW', senderColor: 'bg-secondary-100 text-secondary-700', subject: 'Joint Reflection Session', preview: 'Hi! Would you be up for doing a joint...', time: '2h ago', unread: true },
  ],
  coach: [
    { id: 'cm-1', senderName: 'Sophie Williams', senderInitials: 'SW', senderColor: 'bg-primary-100 text-primary-700', subject: 'Reschedule Coaching Session', preview: 'Hi Med, I have a work commitment on the 18th...', time: '2h ago', unread: true },
    { id: 'cm-2', senderName: 'Tom Richards', senderInitials: 'TR', senderColor: 'bg-primary-100 text-primary-700', subject: 'Missed Session', preview: 'Sorry I missed the Teams session yesterday...', time: '3h ago', unread: true },
    { id: 'cm-3', senderName: 'Lauren Mitchell', senderInitials: 'LM', senderColor: 'bg-accent-100 text-accent-700', subject: 'Employer Joint Meeting', preview: 'Thanks for flagging this. I have spoken with...', time: 'Yesterday', unread: false },
    { id: 'cm-4', senderName: 'System Notification', senderInitials: 'SY', senderColor: 'bg-amber-100 text-amber-700', subject: 'OTJH Alert', preview: 'Finn Murphy is now 2 months behind on OTJH...', time: 'Yesterday', unread: true },
  ],
  admin: [
    { id: 'am-1', senderName: 'Tom Bradley', senderInitials: 'TB', senderColor: 'bg-accent-100 text-accent-700', subject: 'QA Review Failed', preview: 'Evidence Pack #EV-2024-442 failed QA review...', time: '2h ago', unread: true },
    { id: 'am-2', senderName: 'Med Maher', senderInitials: 'MM', senderColor: 'bg-primary-100 text-primary-700', subject: 'Coaching Summary', preview: 'Please find attached the monthly coaching...', time: 'Yesterday', unread: false },
    { id: 'am-3', senderName: 'System Security', senderInitials: 'SS', senderColor: 'bg-red-100 text-red-700', subject: 'Security Alert', preview: 'Multiple failed login attempts detected...', time: '2d ago', unread: true },
    { id: 'am-4', senderName: 'Crispin Jones', senderInitials: 'CJ', senderColor: 'bg-primary-100 text-primary-700', subject: 'New Module Published', preview: 'I have published the new Data Cleaning module...', time: '2d ago', unread: true },
  ],
  tutor: [
    { id: 'tm-1', senderName: 'Sarah Mitchell', senderInitials: 'SM', senderColor: 'bg-primary-100 text-primary-700', subject: 'Module Assignment Question', preview: 'Hi, I\'m stuck on the PESTLE analysis part...', time: '1h ago', unread: true },
    { id: 'tm-2', senderName: 'Med Maher', senderInitials: 'MM', senderColor: 'bg-primary-100 text-primary-700', subject: 'Learner Progress Update', preview: 'Sophie Williams KSB at 92%, nearly gateway...', time: '4h ago', unread: false },
    { id: 'tm-3', senderName: 'Alex Carter', senderInitials: 'AC', senderColor: 'bg-accent-100 text-accent-700', subject: 'Module Allocation', preview: 'I will assign this module to the cohorts...', time: 'Yesterday', unread: false },
  ],
  employer: [
    { id: 'em-1', senderName: 'Med Maher', senderInitials: 'MM', senderColor: 'bg-primary-100 text-primary-700', subject: 'Sophie Progress Concern', preview: 'Sophie has been falling behind on OTJH...', time: '3h ago', unread: true },
    { id: 'em-2', senderName: 'Sarah Mitchell', senderInitials: 'SM', senderColor: 'bg-primary-100 text-primary-700', subject: 'Employer Review', preview: 'Thursday at 10am works perfectly for me...', time: 'Yesterday', unread: false },
    { id: 'em-3', senderName: 'KBC Support', senderInitials: 'KS', senderColor: 'bg-secondary-100 text-secondary-700', subject: 'Workplace Confirmation', preview: 'Action required: Confirm OTJH hours for May...', time: '2d ago', unread: true },
  ],
  compliance: [
    { id: 'coml-1', senderName: 'Tom Bradley', senderInitials: 'TB', senderColor: 'bg-accent-100 text-accent-700', subject: 'ILR Deadline Reminder', preview: 'June ILR deadline 14 June. Please confirm...', time: '1h ago', unread: true },
    { id: 'coml-2', senderName: 'Alex Carter', senderInitials: 'AC', senderColor: 'bg-accent-100 text-accent-700', subject: 'Onboarding Pack', preview: 'New starter James Wilson approved...', time: '5h ago', unread: false },
    { id: 'coml-3', senderName: 'Med Maher', senderInitials: 'MM', senderColor: 'bg-primary-100 text-primary-700', subject: 'Employer Contracting', preview: 'TechKent Ltd contracting pack ready for review...', time: 'Yesterday', unread: true },
  ],
  qa: [
    { id: 'qam-1', senderName: 'Alex Carter', senderInitials: 'AC', senderColor: 'bg-accent-100 text-accent-700', subject: 'Ofsted Readiness', preview: 'We have Ofsted readiness checks coming up...', time: '30m ago', unread: true },
    { id: 'qam-2', senderName: 'Med Maher', senderInitials: 'MM', senderColor: 'bg-primary-100 text-primary-700', subject: 'QA Sample Request', preview: 'Please sample Cohort B evidence for July...', time: '2h ago', unread: true },
    { id: 'qam-3', senderName: 'Crispin Jones', senderInitials: 'CJ', senderColor: 'bg-primary-100 text-primary-700', subject: 'Module QA Approved', preview: 'Data Cleaning module fully QA-approved...', time: 'Yesterday', unread: false },
  ],
  leadership: [
    { id: 'lsm-1', senderName: 'Alex Carter', senderInitials: 'AC', senderColor: 'bg-accent-100 text-accent-700', subject: 'Leadership Meeting Agenda', preview: 'Please find the agenda for the upcoming...', time: '4h ago', unread: false },
    { id: 'lsm-2', senderName: 'Med Maher', senderInitials: 'MM', senderColor: 'bg-primary-100 text-primary-700', subject: 'At-risk Learner Report', preview: '2 learners flagged for July review...', time: 'Yesterday', unread: true },
    { id: 'lsm-3', senderName: 'Tom Bradley', senderInitials: 'TB', senderColor: 'bg-accent-100 text-accent-700', subject: 'SAR/QIP Evidence', preview: 'Outstanding evidence pack for Ofsted prep...', time: '2d ago', unread: false },
  ],
  default: [
    { id: 'dm-1', senderName: 'System', senderInitials: 'SY', senderColor: 'bg-amber-100 text-amber-700', subject: 'Welcome to KBC LearningOS', preview: 'Your account has been set up successfully...', time: '1d ago', unread: false },
    { id: 'dm-2', senderName: 'Support Team', senderInitials: 'ST', senderColor: 'bg-secondary-100 text-secondary-700', subject: 'Need help?', preview: 'Contact your admin for any questions...', time: '2d ago', unread: false },
  ],
};