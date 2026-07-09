/* ═══════════════════════════════════════════════════════════════
   USER GUIDE — Role-based professional step-by-step guides
   ═══════════════════════════════════════════════════════════════ */

export interface GuideStep {
  step: number;
  title: string;
  description: string;
  action?: string;
  tip?: string;
  icon: string;
}

export interface GuideSection {
  id: string;
  title: string;
  description: string;
  icon: string;
  pagePath: string;
  steps: GuideStep[];
  role: string;
}

export const USER_GUIDES: GuideSection[] = [
  // ═══════════════════════════════════════════════════════════════
  // LEARNER GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'learner-overview',
    title: 'Learner Dashboard',
    description: 'Your central hub for tracking progress, upcoming activities, and key notifications.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/learner',
    role: 'learner',
    steps: [
      { step: 1, title: 'Welcome to Your Dashboard', description: 'When you first log in, you will see your learner dashboard. This is your home base. The top section shows your current week, programme progress, and any urgent notifications.', icon: 'ri-home-line' },
      { step: 2, title: 'Check Your Weekly Progress', description: 'The "This Week" card shows your current week number, how many components are completed, and any overdue items. Click the card to go to your detailed weekly view.', icon: 'ri-calendar-check-line', action: 'Navigate to This Week' },
      { step: 3, title: 'Track Your KSB Progress', description: 'The KSB Progress section shows how many Knowledge, Skills, and Behaviours are validated, evidenced, or still pending. Click "View KSBs" to see the full tracker.', icon: 'ri-bar-chart-2-line', action: 'Navigate to KSBs' },
      { step: 4, title: 'Monitor Off-the-Job Hours', description: 'Your OTJH card shows hours logged this month and total hours. The progress bar shows you how close you are to your monthly target. Click to log new hours.', icon: 'ri-time-line', action: 'Navigate to OTJH' },
      { step: 5, title: 'View Upcoming Quizzes', description: 'The Quizzes card shows upcoming assessments with their due dates. Click to start preparing or take a quiz.', icon: 'ri-questionnaire-line', action: 'Navigate to Quizzes' },
      { step: 6, title: 'Access Your Learning Modules', description: 'The Learning Journey section shows your modules in progress. Click any module to see its roadmap, components, and milestones.', icon: 'ri-compass-3-line', action: 'Navigate to Modules' },
      { step: 7, title: 'Read Notifications', description: 'Check the notification bell at the top right for messages from your coach, tutor, or system alerts about deadlines and actions required.', icon: 'ri-notification-3-line', tip: 'Red dots mean unread urgent notifications' },
    ],
  },
  {
    id: 'learner-this-week',
    title: 'This Week — Weekly Learning Plan',
    description: 'Your week-by-week breakdown of activities, components, quizzes, and OTJH tasks.',
    icon: 'ri-calendar-check-line',
    pagePath: '/learner/this-week',
    role: 'learner',
    steps: [
      { step: 1, title: 'Understand Your Weekly Layout', description: 'At the top of the page, you will see your current week number, date range, and module theme. This gives you context for everything below.', icon: 'ri-calendar-line' },
      { step: 2, title: 'Review Snapshot Cards', description: 'The four snapshot cards show: (1) Components this week, (2) KSBs covered, (3) OTJH target, (4) Due items. These give you a quick status check.', icon: 'ri-layout-grid-line' },
      { step: 3, title: 'Start with Your Current Priority', description: 'The "Current Priority" section highlights the first incomplete component. Click "Start Learning" to open the component — whether it is a video, reading, podcast, or quiz.', icon: 'ri-play-circle-line', action: 'Click Start Learning' },
      { step: 4, title: 'Work Through Learning Components', description: 'The Learning Components list shows all 11 activities for the week. Each has a status icon (completed, in progress, or not started). Click any component to open it.', icon: 'ri-stack-line' },
      { step: 5, title: 'Log Your OTJH Hours', description: 'The OTJH section shows your weekly target and current progress. Click "Add OTJH Entry" to log workplace learning hours. You must link hours to a module and KSBs.', icon: 'ri-time-line', action: 'Click Add OTJH Entry' },
      { step: 6, title: 'Check KSB Development', description: 'Scroll down to the KSB Development section. Each KSB card shows your progress. Click "Add Evidence" to upload evidence for any KSB.', icon: 'ri-bar-chart-2-line', action: 'Click Add Evidence' },
      { step: 7, title: 'Review Deadlines', description: 'The Deadlines section lists all components with their due dates. Overdue items are highlighted in red. Complete these first.', icon: 'ri-alarm-line', tip: 'Red-highlighted items are overdue and need immediate attention' },
      { step: 8, title: 'Access Resources', description: 'The Resources section lists all available materials for this week. This includes videos, readings, articles, and templates. Everything you need is here.', icon: 'ri-book-open-line' },
      { step: 9, title: 'Read Coach & Tutor Guidance', description: 'At the bottom, your coach and tutor have left specific guidance for this week. Read these before starting components — they often contain tips and focus areas.', icon: 'ri-chat-smile-2-line' },
    ],
  },
  {
    id: 'learner-quizzes',
    title: 'Quizzes & Knowledge Checks',
    description: 'Track, take, and review all your assessments. Link quiz results to your KSB progress.',
    icon: 'ri-questionnaire-line',
    pagePath: '/learner/quizzes',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Assessment Hub', description: 'The top of the page shows your quiz stats: Passed, Average Score, Highest Score, Quiz Streak, and Points. This gives you a quick overview of your assessment performance.', icon: 'ri-bar-chart-2-line' },
      { step: 2, title: 'Start Your Priority Quiz', description: 'The "Current Priority" card shows your next required quiz. It includes the module, question count, pass mark, and KSBs covered. Click "Start Quiz" to begin.', icon: 'ri-play-circle-line', action: 'Click Start Quiz on the Priority Card' },
      { step: 3, title: 'Take the Quiz', description: 'The quiz modal opens with a timer. Read each question carefully, select your answer, and use "Flag for Review" if you are unsure. Navigate between questions using the numbered buttons at the bottom.', icon: 'ri-timer-line', tip: 'You can flag questions and come back to them later before submitting' },
      { step: 4, title: 'Review Before Submitting', description: 'Click "Review" at the bottom to see which questions you have answered and which are flagged. You can jump back to any question from the review screen.', icon: 'ri-eye-line', action: 'Click Review' },
      { step: 5, title: 'Submit and See Results', description: 'After submitting, you will see your score, pass/fail status, time taken, and a detailed KSB breakdown. Correct and incorrect answers are shown with explanations.', icon: 'ri-check-double-line' },
      { step: 6, title: 'Review Failed Areas', description: 'If you failed, the result screen shows which KSBs need more work. Click "Retake Quiz" to try again, or click "View KSBs" to go to your KSB tracker and strengthen weak areas.', icon: 'ri-refresh-line', action: 'Click Retake or View KSBs' },
      { step: 7, title: 'Browse the Quiz Library', description: 'Use the "Assessment Library" tab to browse all quizzes. Filter by status (All, Priority, Not Started, Passed, Failed, Locked). Click any quiz to expand it and see full details.', icon: 'ri-stack-line' },
      { step: 8, title: 'View Your History', description: 'Click the "History" tab to see every quiz you have taken, with scores, dates, attempts, and statuses. This shows your progression over time.', icon: 'ri-history-line' },
      { step: 9, title: 'Check KSB Impact', description: 'Click the "KSB Impact" tab to see which KSBs are assessed by which quizzes. Each KSB shows a progress bar of how many related quizzes you have passed.', icon: 'ri-node-tree' },
      { step: 10, title: 'Follow Revision Recommendations', description: 'The "Revision Recommendations" section shows personalised resources based on your quiz performance. Each shows why it is recommended, related KSBs, and estimated time. Click "Open" to start.', icon: 'ri-lightbulb-line', action: 'Click Open on any recommendation' },
      { step: 11, title: 'Track Your Badges', description: 'The "Knowledge Badges" section shows earned and locked badges. Earned badges are highlighted with gold styling. Unlock badges by passing quizzes and achieving streaks.', icon: 'ri-award-line' },
    ],
  },
  {
    id: 'learner-ksbs',
    title: 'KSB Progress Tracker',
    description: 'Track, evidence, and validate your Knowledge, Skills, and Behaviours.',
    icon: 'ri-bar-chart-2-line',
    pagePath: '/learner/ksbs',
    role: 'learner',
    steps: [
      { step: 1, title: 'Understand KSB Status', description: 'Each KSB has a status: Validated (green), Evidenced (amber), Applied (purple), Pending (light amber), or Not Started (grey). Your goal is to get all KSBs to Validated before Gateway.', icon: 'ri-information-line' },
      { step: 2, title: 'View by Category', description: 'Use the tabs at the top to filter by All, Knowledge, Skills, or Behaviours. The colour-coded dots show which category each KSB belongs to.', icon: 'ri-filter-3-line' },
      { step: 3, title: 'Switch Between Card and List Views', description: 'Toggle between Card view (visual cards with progress bars) and List view (table format). Use the toggle at the top right of the KSB section.', icon: 'ri-layout-grid-line' },
      { step: 4, title: 'Check Your Progress', description: 'Each KSB card shows a percentage progress bar. The percentage is based on evidence submitted and tutor validation. Hover over the progress bar for more detail.', icon: 'ri-percent-line' },
      { step: 5, title: 'Add Evidence to a KSB', description: 'Click "Add Evidence" on any KSB card. You will be taken to the Evidence Library where you can upload a new file and link it to the selected KSB.', icon: 'ri-add-line', action: 'Click Add Evidence' },
      { step: 6, title: 'View Existing Evidence', description: 'If a KSB shows "View Evidence" instead of "Add Evidence", click it to see all uploaded evidence linked to that KSB. You can see the evidence status and any tutor feedback.', icon: 'ri-folder-open-line', action: 'Click View Evidence' },
      { step: 7, title: 'Check Gateway Readiness', description: 'The right sidebar shows a circular progress chart. It shows your overall percentage and how many KSBs are in each status. You need 100% before Gateway.', icon: 'ri-flag-line' },
      { step: 8, title: 'Review Suggested Next Evidence', description: 'The "Suggested Next Evidence" panel shows specific tasks your coach recommends. Each shows which KSBs it links to and why it is recommended. Complete these first.', icon: 'ri-lightbulb-line' },
      { step: 9, title: 'Address Weak KSBs', description: 'The "Needs Attention" panel highlights KSBs below 50% progress. Click "Upload Evidence Now" to immediately add evidence for these weak areas.', icon: 'ri-alert-line', tip: 'Focus on these KSBs first — they are the biggest barrier to Gateway readiness' },
    ],
  },
  {
    id: 'learner-evidence',
    title: 'Evidence Library',
    description: 'Upload, manage, and link all your workplace evidence to KSBs.',
    icon: 'ri-folder-upload-line',
    pagePath: '/learner/evidence',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Evidence', description: 'The Evidence Library shows all your uploaded evidence items. Each item shows its title, linked KSBs, upload date, status, and file type.', icon: 'ri-folder-line' },
      { step: 2, title: 'Upload New Evidence', description: 'Click the "Upload Evidence" button. Choose a file (PDF, Word, image, or video), give it a title, and write a description of what the evidence demonstrates.', icon: 'ri-upload-line', action: 'Click Upload Evidence' },
      { step: 3, title: 'Link to KSBs', description: 'When uploading, you must link the evidence to at least one KSB. Select the relevant KSBs from the list. The more specific you are, the faster the validation process.', icon: 'ri-link' },
      { step: 4, title: 'Select Evidence Type', description: 'Choose the correct evidence type: Workplace Reflection, Project Output, Meeting Notes, Professional Discussion, or Other. This helps your tutor understand the context.', icon: 'ri-file-list-line' },
      { step: 5, title: 'Submit for Validation', description: 'After uploading and linking KSBs, click "Submit for Validation". Your tutor will review the evidence and either validate it or request changes.', icon: 'ri-send-plane-line', tip: 'You can edit or delete evidence before it is submitted. Once submitted, it is locked until reviewed.' },
      { step: 6, title: 'Check Evidence Status', description: 'Each evidence item shows a status: Draft (not submitted), Submitted (awaiting review), Under Review (tutor is checking), Validated (accepted), or Rejected (needs changes).', icon: 'ri-checkbox-circle-line' },
      { step: 7, title: 'Read Tutor Feedback', description: 'If evidence is rejected, click "View Feedback" to see the tutor\'s comments. Make the requested changes and re-submit.', icon: 'ri-chat-1-line', tip: 'Read feedback carefully — it is the fastest way to get your evidence validated' },
    ],
  },
  {
    id: 'learner-otjh',
    title: 'Off-the-Job Hours (OTJH)',
    description: 'Log and track your off-the-job training hours for compliance.',
    icon: 'ri-time-line',
    pagePath: '/learner/otjh',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your OTJH Dashboard', description: 'The OTJH page shows your total hours logged, monthly targets, and a breakdown by activity type. You can also see your compliance status.', icon: 'ri-dashboard-line' },
      { step: 2, title: 'Add an OTJH Entry', description: 'Click "Add OTJH Entry". Fill in the date, activity type (e.g., Live Session, Self-Study, Workplace Project), description, and hours claimed.', icon: 'ri-add-line', action: 'Click Add OTJH Entry' },
      { step: 3, title: 'Link to Module and KSBs', description: 'Select the module this activity relates to, then select the KSBs demonstrated. This is mandatory — hours without KSB links may be rejected by your employer or coach.', icon: 'ri-link', tip: 'Always link hours to KSBs. Unlinked hours are flagged in compliance reviews.' },
      { step: 4, title: 'Upload Supporting Evidence (Optional)', description: 'You can attach a file (e.g., meeting notes, project brief, session notes) to support your OTJH claim. This is recommended but not always required.', icon: 'ri-attachment-line' },
      { step: 5, title: 'Submit for Validation', description: 'Click "Submit". Your entry goes to your employer and coach for validation. Once validated, the hours count toward your total.', icon: 'ri-send-plane-line' },
      { step: 6, title: 'Track Monthly Targets', description: 'The monthly target section shows how many hours you have logged this month versus your target. The progress bar and chart help you stay on track.', icon: 'ri-bar-chart-line', tip: 'You need 6 hours per week minimum. Falling behind triggers coach alerts.' },
      { step: 7, title: 'Review History', description: 'The OTJH history table shows every entry with date, hours, type, module, status, and validator. Use the filters to search by date range or module.', icon: 'ri-history-line' },
    ],
  },
  {
    id: 'learner-training-plan',
    title: 'Training Plan',
    description: 'View your full programme schedule, milestones, and week-by-week activities.',
    icon: 'ri-road-map-line',
    pagePath: '/learner/training-plan',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Training Plan Overview', description: 'The training plan shows your entire 60-week programme at a glance. The timeline shows your current position, completed weeks, and upcoming modules.', icon: 'ri-road-map-line' },
      { step: 2, title: 'Switch to Week by Week', description: 'Click the "Week by Week" button at the top right. This opens a dropdown with all 60 weeks, grouped by month. Click any week to see its detailed activities.', icon: 'ri-calendar-line', action: 'Click Week by Week' },
      { step: 3, title: 'Filter Weeks by Status', description: 'Use the filter tabs (All, Past, Current, Upcoming) to quickly find the weeks you are interested in. The current week is highlighted in purple.', icon: 'ri-filter-3-line' },
      { step: 4, title: 'Drill Into Any Week', description: 'Clicking a week takes you to its detailed page. This page has the same layout as "This Week" but shows any week in the programme, including past and future weeks.', icon: 'ri-arrow-right-line', action: 'Click any week number' },
      { step: 5, title: 'View Monthly Groups', description: 'The training plan is grouped by month. Each month shows the module title, weeks included, and key activities. This helps you plan ahead.', icon: 'ri-calendar-check-line' },
      { step: 6, title: 'Check Gateway Milestones', description: 'The timeline shows your Gateway date and EPA readiness checkpoints. These are fixed dates — make sure your progress aligns with them.', icon: 'ri-flag-line', tip: 'Your Gateway is October 2027. All KSBs must be 100% validated by then.' },
    ],
  },
  {
    id: 'learner-modules',
    title: 'Learning Journey — Modules',
    description: 'Explore your modules, view roadmaps, and track milestones.',
    icon: 'ri-compass-3-line',
    pagePath: '/learner/modules',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Module Cards', description: 'The modules page shows each module as a card with its title, status, weeks, and progress. Cards are colour-coded by status: completed (green), in progress (purple), upcoming (amber), or locked (grey).', icon: 'ri-layout-grid-line' },
      { step: 2, title: 'Expand a Module Card', description: 'Click any module card to expand it. The expanded view shows the module description, KSBs covered, components, learning outcomes, and a mini timeline.', icon: 'ri-arrow-down-s-line', action: 'Click any module card' },
      { step: 3, title: 'Navigate the Module Roadmap', description: 'The roadmap shows each milestone as a connected dot. The horizontal timeline (desktop) or vertical timeline (mobile) shows your progress through the module. Click any milestone to scroll to that component.', icon: 'ri-node-tree', action: 'Click any milestone' },
      { step: 4, title: 'Toggle Timeline View', description: 'Click "Timeline" in the roadmap toggle to switch to a Gantt-style calendar view. Each module appears as a bar on the 72-week timeline. Click any bar to jump to that module.', icon: 'ri-bar-chart-horizontal-line', action: 'Click Timeline' },
      { step: 5, title: 'Track Component Progress', description: 'Each component within the module shows its status, type, and due date. Components include: Video, Reading, Podcast, Activity, Live Session, Quiz, and OTJH. Complete all components to finish the module.', icon: 'ri-stack-line' },
      { step: 6, title: 'Check Module Status', description: 'Each module card has a status badge. "In Progress" means you have started but not finished. "Completed" means all components are done. "Upcoming" is not yet started. "Locked" has prerequisites.', icon: 'ri-information-line' },
    ],
  },
  {
    id: 'learner-attendance',
    title: 'Attendance & Catch-up',
    description: 'Track your live session attendance and manage catch-up sessions.',
    icon: 'ri-calendar-check-line',
    pagePath: '/learner/attendance',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Attendance Record', description: 'The attendance page shows your live session history. Each session shows the date, title, module, type, and your attendance status (Present, Absent, or Excused).', icon: 'ri-calendar-line' },
      { step: 2, title: 'Check Your Attendance Rate', description: 'The top stats show your overall attendance rate, sessions attended, and sessions missed. You need 90% attendance to meet the apprenticeship requirement.', icon: 'ri-percent-line', tip: 'Below 90% attendance triggers a coach intervention and catch-up plan.' },
      { step: 3, title: 'Report an Absence', description: 'If you cannot attend a session, click "Report Absence" before the session starts. Select the session, reason, and details. Your coach and tutor will be notified.', icon: 'ri-error-warning-line', action: 'Click Report Absence' },
      { step: 4, title: 'Access Catch-up Sessions', description: 'Missed sessions are listed in the Catch-up section. Each shows a recording link, session notes, and any catch-up tasks. Complete these within the deadline shown.', icon: 'ri-timer-line', action: 'Click Watch Recording' },
      { step: 5, title: 'View Upcoming Sessions', description: 'The Upcoming Sessions section shows all live sessions in the next 4 weeks. Add them to your calendar using the calendar export button.', icon: 'ri-calendar-event-line', tip: 'Click the calendar icon to download an .ics file for your personal calendar.' },
    ],
  },
  {
    id: 'learner-support',
    title: 'Support & Help',
    description: 'Get help, submit support tickets, and find answers to common questions.',
    icon: 'ri-chat-1-line',
    pagePath: '/learner/support',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Tickets', description: 'The "My Tickets" tab shows all your support tickets. Each ticket shows the subject, category, priority, status, and last update. Click any ticket to view the full conversation.', icon: 'ri-ticket-line' },
      { step: 2, title: 'Submit a New Ticket', description: 'Click "New Ticket" at the top right. Choose a category (Technical, Learning Support, Data/MIS, etc.), set priority, write a subject, and describe your issue in detail.', icon: 'ri-add-line', action: 'Click New Ticket' },
      { step: 3, title: 'Browse the FAQ', description: 'Click the "FAQ" tab for answers to common questions about OTJH, evidence, KSBs, progress reviews, and the Gateway. Expand any question to see the answer.', icon: 'ri-question-answer-line', tip: 'Most questions about OTJH, KSBs, and evidence are answered in the FAQ.' },
      { step: 4, title: 'Contact Your Support Team', description: 'Click the "Contact Us" tab to see your coach, tutor, and support team contact details. Each shows email, phone, and availability. Click "Email" or "Call" to reach them directly.', icon: 'ri-phone-line', action: 'Click Email or Call' },
      { step: 5, title: 'Check Ticket Status', description: 'Ticket statuses are: Open (submitted, awaiting response), In Progress (being investigated), Resolved (issue fixed), or Closed (completed). Click a ticket to see updates and reply.', icon: 'ri-information-line' },
      { step: 6, title: 'For Urgent Issues', description: 'If your issue is affecting your learning, set priority to "High". For critical issues (e.g., cannot access platform), call the IT Helpdesk on 01227 811 299.', icon: 'ri-alert-line', tip: 'For safeguarding concerns, use the dedicated safeguarding contact at the bottom of the Contact Us tab.' },
    ],
  },
  {
    id: 'learner-profile',
    title: 'Your Profile',
    description: 'View and update your personal details, programme information, and contact settings.',
    icon: 'ri-user-line',
    pagePath: '/learner/profile',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Profile', description: 'Your profile page shows your personal details, programme information, employer details, and programme timeline. This is read-only for most fields — updates go through your coach.', icon: 'ri-user-line' },
      { step: 2, title: 'Check Programme Details', description: 'The Programme Information section shows your programme name, level, start date, planned end date, and Gateway target. These are set during enrolment and updated by your coach.', icon: 'ri-book-open-line' },
      { step: 3, title: 'Update Contact Details', description: 'You can update your email, phone, and address. Click "Edit" next to any field, make changes, and click "Save". Changes may require verification.', icon: 'ri-edit-line', action: 'Click Edit' },
      { step: 4, title: 'View Your Coach and Tutor', description: 'The Coach & Tutor section shows your assigned coach and tutor with their contact details. Use this to reach out directly if needed.', icon: 'ri-team-line' },
      { step: 5, title: 'Change Your Profile Photo', description: 'Click on your profile photo to upload a new one. Use a professional, clear headshot. The file should be under 2MB.', icon: 'ri-camera-line', action: 'Click profile photo' },
    ],
  },
  {
    id: 'learner-catchup',
    title: 'Catch-Up Learning Hub',
    description: 'Complete missed sessions, submit evidence, and restore your attendance record.',
    icon: 'ri-timer-flash-line',
    pagePath: '/learner/catchup',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Catch-Up Hub', description: 'The Catch-Up page shows all sessions you missed and need to complete. The hero section shows your catch-up completion rate, outstanding count, and journey progress.', icon: 'ri-dashboard-line' },
      { step: 2, title: 'Check Outstanding Items', description: 'The Outstanding tab lists all catch-up sessions that still need your attention. Each item shows the original session, reason for absence, deadline, and progress percentage.', icon: 'ri-timer-line' },
      { step: 3, title: 'Prioritise Overdue Items', description: 'Overdue catch-ups are highlighted in red with a "Priority Action" banner at the top. These need immediate attention to avoid attendance flags.', icon: 'ri-alert-line', tip: 'Complete overdue items first — they affect your attendance rate and can trigger coach intervention.' },
      { step: 4, title: 'Expand and Start Catch-Up', description: 'Click any catch-up item to expand it. You will see a checklist (Recording Watched, Reflection Done, Workplace Application, KSB Linked). For overdue items, click "Start Catch-Up" to open the evidence form.', icon: 'ri-expand-diagonal-line', action: 'Click Start Catch-Up' },
      { step: 5, title: 'Submit Catch-Up Evidence', description: 'Fill in the recording date, time spent, key learning points, workplace application, and KSB links. Click "Submit Evidence" to send it for coach review.', icon: 'ri-file-text-line', action: 'Click Submit Evidence' },
      { step: 6, title: 'Review Completed Items', description: 'Switch to the Completed tab to see all approved catch-ups. Each shows the approval date and status. Approved catch-ups restore your attendance record.', icon: 'ri-check-double-line' },
      { step: 7, title: 'Sort and Filter', description: 'Use the sort options (Deadline, Progress, Session) to organise your catch-up list. Sort by Deadline to see the most urgent items first.', icon: 'ri-filter-3-line' },
    ],
  },
  {
    id: 'learner-monthly-cycle',
    title: 'Monthly Learning Cycle',
    description: 'Track your monthly assignments, coaching readiness, and end-of-month outcomes.',
    icon: 'ri-calendar-2-line',
    pagePath: '/learner/monthly-cycle',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Monthly Overview', description: 'The Monthly Cycle page shows your current month progress, assignment status, and coaching readiness score. This is your monthly checkpoint dashboard.', icon: 'ri-dashboard-line' },
      { step: 2, title: 'Check Your Current Focus', description: 'The "Current Focus" card highlights the most important task for this month. It could be an assignment, KSB evidence, or preparation for a coaching session.', icon: 'ri-focus-2-line', action: 'Complete your Current Focus' },
      { step: 3, title: 'Track Assignment Progress', description: 'The Assignment section shows all monthly assignments with their due dates and status. Each has a progress bar showing how much is complete.', icon: 'ri-task-line' },
      { step: 4, title: 'Review Coaching Readiness', description: 'Your coaching readiness score is based on assignment completion, KSB progress, and OTJH logging. Aim for 80% or higher before each coaching session.', icon: 'ri-heart-pulse-line', tip: 'Complete assignments and log OTJH at least 2 days before coaching for the best readiness score.' },
      { step: 5, title: 'View Monthly Journey Timeline', description: 'The timeline shows all key events this month: assignment deadlines, coaching sessions, and checkpoint quizzes. Click any event to see details.', icon: 'ri-timeline-view' },
      { step: 6, title: 'Check End-of-Month Outcome', description: 'At the end of each month, this section shows your outcome: On Track, Needs Attention, or Intervention Required. This determines next month\'s plan.', icon: 'ri-flag-line' },
    ],
  },
  {
    id: 'learner-monthly-coaching',
    title: 'Monthly Coaching',
    description: 'Prepare for and review your monthly 1:1 coaching sessions.',
    icon: 'ri-chat-smile-2-line',
    pagePath: '/learner/monthly-coaching',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Coaching Dashboard', description: 'The Monthly Coaching page shows your upcoming coaching session, agenda items, KSBs to present, and workplace application progress.', icon: 'ri-dashboard-line' },
      { step: 2, title: 'Review Last Coaching Meeting', description: 'The "Last Coaching Meeting" section shows what you discussed, agreed actions, and follow-up tasks. Make sure all actions are completed before the next session.', icon: 'ri-history-line' },
      { step: 3, title: 'Prepare Your KSB Presentation', description: 'Each coaching session, you will present 3 KSBs. Prepare evidence for each one: what you learned, how you applied it, and the outcome. Click "Prepare" to build your presentation.', icon: 'ri-presentation-line', action: 'Click Prepare' },
      { step: 4, title: 'Complete Pre-Coaching Actions', description: 'The Action Tracker shows tasks to complete before coaching. Each task has a status and due date. Green means done, amber means in progress, red means overdue.', icon: 'ri-checkbox-circle-line' },
      { step: 5, title: 'Review Your Agenda', description: 'The Meeting Agenda shows the session structure: Progress Check, KSB Presentation, OTJH Review, Workplace Application, Barriers, and Next Steps. Click any section to prepare.', icon: 'ri-list-check' },
      { step: 6, title: 'Log Workplace Application', description: 'The Workplace Application section tracks how you have applied learning at work. Add examples of tasks, projects, or situations where you used KSBs in your job.', icon: 'ri-building-2-line' },
      { step: 7, title: 'Review Next Meetings', description: 'The upcoming meetings section shows your next two coaching sessions with dates and focus areas. This helps you plan ahead and prepare early.', icon: 'ri-calendar-schedule-line' },
    ],
  },
  {
    id: 'learner-progress-reviews',
    title: 'Progress Reviews',
    description: 'Prepare for and participate in tripartite progress reviews with your coach and employer.',
    icon: 'ri-file-chart-line',
    pagePath: '/learner/progress-reviews',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Review Dashboard', description: 'The Progress Reviews page shows your review schedule, upcoming review date, preparation status, and past review history. Reviews happen every 12 weeks.', icon: 'ri-dashboard-line' },
      { step: 2, title: 'Check Your Next Review', description: 'The "Next Review" card shows the date, time, attendees (you, your coach, your employer), and the review number. Click "Prepare" to start getting ready.', icon: 'ri-calendar-event-line', action: 'Click Prepare' },
      { step: 3, title: 'Complete Preparation Forms', description: 'Before each review, you need to complete preparation forms. These include: Self-Assessment, Workplace Feedback, OTJH Summary, and KSB Progress. Click each form to fill it in.', icon: 'ri-file-list-3-line', action: 'Click each form' },
      { step: 4, title: 'Review Areas Dashboard', description: 'The Review Areas section shows the 10 review areas: Attendance, OTJH, KSB Progress, Module Progress, Quizzes, Evidence, Workplace Practice, Maths/English, Behaviour, and Safeguarding. Each has a RAG rating.', icon: 'ri-layout-grid-line' },
      { step: 5, title: 'View Your Review Timeline', description: 'The timeline shows all past and upcoming reviews. Click any past review to see its notes, actions, and outcomes. This helps you prepare for future reviews.', icon: 'ri-timeline-view' },
      { step: 6, title: 'Check Gateway Next Actions', description: 'The Gateway section shows what you need to do before Gateway: KSB %, evidence requirements, OTJH target, and any outstanding actions from reviews.', icon: 'ri-flag-line' },
      { step: 7, title: 'View Review History', description: 'The Review History section shows detailed records of all past reviews. Each includes the agenda, notes, actions, and employer comments. Click any review to expand it.', icon: 'ri-history-line' },
    ],
  },
  {
    id: 'learner-gateway',
    title: 'Gateway Readiness',
    description: 'Track your readiness for the Gateway and End-Point Assessment (EPA).',
    icon: 'ri-flag-line',
    pagePath: '/learner/gateway',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Gateway Dashboard', description: 'The Gateway page shows your overall readiness, EPA timeline, and what still needs to be completed. This is your countdown to the final assessment.', icon: 'ri-dashboard-line' },
      { step: 2, title: 'Check EPA Component Readiness', description: 'Each EPA component (Project, Professional Discussion, Presentation) has a readiness score. All must be green or amber before you can go through Gateway.', icon: 'ri-pie-chart-2-line' },
      { step: 3, title: 'Review KSB Risk Analysis', description: 'The risk analysis shows which KSBs are at risk of not being validated before Gateway. Focus on these KSBs and add evidence urgently.', icon: 'ri-error-warning-line', tip: 'Red KSBs need immediate evidence upload. Your coach can help prioritise which ones to focus on.' },
      { step: 4, title: 'Check Evidence Coverage', description: 'This shows how well your evidence covers all required KSBs. Gaps are highlighted in red. Upload new evidence to close the gaps.', icon: 'ri-folder-check-line' },
      { step: 5, title: 'View Portfolio Health Check', description: 'Your portfolio health score is based on evidence quality, KSB coverage, and consistency. Aim for 90% or higher before Gateway.', icon: 'ri-heart-pulse-line' },
      { step: 6, title: 'Review Predicted EPA Outcome', description: 'Based on your current progress, this predicts your likely EPA grade: Distinction, Merit, Pass, or Refer. Use this to understand what you need to improve.', icon: 'ri-award-line' },
      { step: 7, title: 'Book a Mock Assessment', description: 'Click "Book Mock Session" to schedule a practice EPA session with your tutor. This is the best way to prepare and identify weak areas.', icon: 'ri-calendar-check-line', action: 'Click Book Mock Session' },
    ],
  },
  {
    id: 'learner-rewards',
    title: 'Rewards & Badges',
    description: 'Earn points, collect badges, and celebrate your learning achievements.',
    icon: 'ri-trophy-line',
    pagePath: '/learner/rewards',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Rewards Dashboard', description: 'The Rewards page shows your total points, earned badges, badge collection progress, and leaderboard position. This is your achievement showcase.', icon: 'ri-dashboard-line' },
      { step: 2, title: 'Browse Your Badges', description: 'Badges are earned by completing milestones: passing quizzes, logging OTJH, finishing modules, and attending sessions. Each badge has a name, icon, and description.', icon: 'ri-award-line' },
      { step: 3, title: 'Click a Badge for Details', description: 'Click any badge to see its detail page. This shows when you earned it, what you did to earn it, and related badges you might want to pursue next.', icon: 'ri-zoom-in-line', action: 'Click any badge' },
      { step: 4, title: 'Track Your Points', description: 'Points are earned for every learning activity. The Points History shows recent point earnings and their sources. Your total determines your leaderboard rank.', icon: 'ri-money-pound-circle-line' },
      { step: 5, title: 'Check the Leaderboard', description: 'The leaderboard shows top learners by points. This is a fun way to stay motivated. Click any learner to see their badge collection.', icon: 'ri-medal-line' },
      { step: 6, title: 'Set Badge Goals', description: 'Locked badges show what you need to do to earn them. Use these as goals to guide your learning activities and stay motivated.', icon: 'ri-lock-line', tip: 'Focus on badges related to your weak KSBs — this kills two birds with one stone.' },
    ],
  },
  {
    id: 'learner-clubs',
    title: 'Clubs & Community',
    description: 'Join learner clubs, participate in events, and connect with fellow apprentices.',
    icon: 'ri-team-line',
    pagePath: '/learner/clubs',
    role: 'learner',
    steps: [
      { step: 1, title: 'Explore Clubs', description: 'The Clubs page shows all available clubs. Each club has a name, description, member count, and activity level. Clubs include: Study Groups, Industry Networks, and Social Communities.', icon: 'ri-grid-line' },
      { step: 2, title: 'Join a Club', description: 'Click "Join" on any club card to become a member. You will get access to the club\'s discussion board, events, and member list. Some clubs may require coach approval.', icon: 'ri-user-add-line', action: 'Click Join' },
      { step: 3, title: 'View Club Details', description: 'Click any club to see its detail page. This shows recent activity, upcoming events, member list, and discussion threads. You can post, comment, and react to posts.', icon: 'ri-information-line', action: 'Click any club' },
      { step: 4, title: 'Browse Events', description: 'Click the Events tab to see upcoming and past events. Events include workshops, guest speakers, networking sessions, and social activities.', icon: 'ri-calendar-event-line' },
      { step: 5, title: 'RSVP to Events', description: 'Click "Attend" on any event to register. You will receive a calendar invite and reminders. Past events show recordings and materials.', icon: 'ri-check-line', action: 'Click Attend' },
      { step: 6, title: 'View Your Schedule', description: 'Click "My Schedule" to see all events you have registered for. This page shows your personal event calendar with dates, times, and links.', icon: 'ri-calendar-schedule-line', action: 'Click My Schedule' },
    ],
  },
  {
    id: 'learner-calendar',
    title: 'Learning Calendar',
    description: 'View all your sessions, deadlines, and events in one calendar.',
    icon: 'ri-calendar-line',
    pagePath: '/learner/calendar',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Calendar', description: 'The Calendar page shows a monthly view with all your sessions, deadlines, quizzes, reviews, and events. Each type has a different colour for easy scanning.', icon: 'ri-calendar-line' },
      { step: 2, title: 'Switch Between Views', description: 'Toggle between Month, Week, and Day views using the buttons at the top right. Month view is best for planning, Week view is best for daily focus.', icon: 'ri-layout-grid-line' },
      { step: 3, title: 'Click Any Event', description: 'Click any calendar event to see its details: title, type, time, module, and a link to the relevant page. For sessions, you will see the join link.', icon: 'ri-zoom-in-line', action: 'Click any event' },
      { step: 4, title: 'Filter by Event Type', description: 'Use the filter panel to show or hide specific event types: Live Sessions, Deadlines, Quizzes, Reviews, and Events. This helps you focus on what matters.', icon: 'ri-filter-3-line' },
      { step: 5, title: 'Add to Your Personal Calendar', description: 'Click the export button to download an .ics file. Import this into Google Calendar, Outlook, or Apple Calendar to see your learning schedule alongside your personal events.', icon: 'ri-download-line', tip: 'Export your calendar weekly to stay on top of deadlines and sessions.' },
    ],
  },
  {
    id: 'learner-messages',
    title: 'Messages & Communication',
    description: 'Chat with your coach, tutor, and support team directly from the platform.',
    icon: 'ri-message-2-line',
    pagePath: '/learner/messages',
    role: 'learner',
    steps: [
      { step: 1, title: 'View Your Messages', description: 'The Messages page shows all your conversations. The left sidebar lists your contacts (coach, tutor, support). The main area shows the selected conversation.', icon: 'ri-message-2-line' },
      { step: 2, title: 'Start a Conversation', description: 'Click any contact to open their conversation. Type your message in the input box at the bottom and press Enter or click Send. You can also send attachments and emojis.', icon: 'ri-send-plane-line' },
      { step: 3, title: 'Use Quick Actions', description: 'The floating action button (FAB) gives quick access to: New Message, Call, Share File, and Schedule Meeting. Click the "+" button to see all options.', icon: 'ri-add-circle-line', action: 'Click the + button' },
      { step: 4, title: 'Make a Call', description: 'Click the phone icon in any conversation to start a voice or video call. The call modal shows call duration, mute, and end call controls.', icon: 'ri-phone-line', action: 'Click the phone icon' },
      { step: 5, title: 'Star Important Messages', description: 'Long-press or right-click any message to star it. Starred messages appear in the Starred section for quick reference later.', icon: 'ri-star-line', tip: 'Star messages with important deadlines or instructions from your coach.' },
      { step: 6, title: 'Use Emoji Reactions', description: 'Hover over any message and click the emoji icon to add a reaction. This is a quick way to acknowledge messages without typing a reply.', icon: 'ri-emotion-line' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // COACH GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'coach-dashboard',
    title: 'Coach Dashboard',
    description: 'Your central command for managing learners, marking, attendance, and coaching.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/coach',
    role: 'coach',
    steps: [
      { step: 1, title: 'Welcome to Your Coach Dashboard', description: 'When you log in, your dashboard shows your caseload overview, urgent actions, attendance alerts, and marking queue status. This is your daily starting point.', icon: 'ri-home-line' },
      { step: 2, title: 'Review Your Caseload', description: 'The Caseload Overview shows the total number of learners, at-risk count, and new starters. Click the Caseload card to view all learner case files.', icon: 'ri-group-line', action: 'Navigate to Caseload' },
      { step: 3, title: 'Check Your Marking Queue', description: 'The Marking Queue card shows pending assignments and evidence submissions. Click to go to the marking queue and start reviewing submissions.', icon: 'ri-edit-line', action: 'Navigate to Marking Queue' },
      { step: 4, title: 'Review Attendance Alerts', description: 'The Attendance section shows learners with low attendance, recent absences, and catch-up overdue. Click to view the attendance dashboard and take action.', icon: 'ri-calendar-check-line', action: 'Navigate to Attendance' },
      { step: 5, title: 'Manage Upcoming Meetings', description: 'The Coaching Meetings section shows your upcoming monthly coaching sessions, progress reviews, and employer meetings. Click to view or reschedule.', icon: 'ri-calendar-schedule-line', action: 'Navigate to Meetings' },
      { step: 6, title: 'Review Employer Actions', description: 'The Employer Actions section shows pending confirmations, OTJH validations, and document signatures required from employers. Click to view the employer actions page.', icon: 'ri-building-2-line', action: 'Navigate to Employer Actions' },
      { step: 7, title: 'Check AI Marking Suggestions', description: 'The AI Marking card shows submissions with AI-generated feedback suggestions. Review these suggestions before finalising your marks.', icon: 'ri-robot-line', action: 'Navigate to AI Marking' },
    ],
  },
  {
    id: 'coach-caseload',
    title: 'Learner Caseload',
    description: 'View, search, and manage all your assigned learners.',
    icon: 'ri-group-line',
    pagePath: '/coach/caseload',
    role: 'coach',
    steps: [
      { step: 1, title: 'View Your Learner List', description: 'The caseload page shows all your learners in a table or card view. Each learner shows their name, programme, cohort, start date, and overall status.', icon: 'ri-list-check' },
      { step: 2, title: 'Search and Filter', description: 'Use the search bar to find learners by name, or use the filters (Programme, Cohort, Status, At-Risk) to narrow the list. The filter panel is at the top of the table.', icon: 'ri-search-line', action: 'Type in search bar or use filter dropdowns' },
      { step: 3, title: 'View Learner Quick Stats', description: 'Each learner row shows quick stats: KSB %, OTJH hours, attendance rate, and next review date. Click any stat to view the detailed report.', icon: 'ri-bar-chart-line' },
      { step: 4, title: 'Open a Learner Case File', description: 'Click the learner\'s name or the "View Case File" button to open their full case file. This shows their complete learning journey, evidence, attendance, and communication history.', icon: 'ri-folder-user-line', action: 'Click learner name or View Case File' },
      { step: 5, title: 'Flag At-Risk Learners', description: 'Learners flagged as "At-Risk" are highlighted in red. Click the "At-Risk" filter to see only these learners. Click any learner to open their risk assessment and action plan.', icon: 'ri-alert-line', tip: 'At-risk learners are auto-flagged based on attendance, OTJH, or KSB progress falling below thresholds.' },
      { step: 6, title: 'Export Caseload Data', description: 'Click the "Export" button at the top right to download the caseload as CSV or Excel. This is useful for offline reporting or monthly reviews.', icon: 'ri-download-line', action: 'Click Export' },
    ],
  },
  {
    id: 'coach-marking',
    title: 'Marking Queue',
    description: 'Review, mark, and provide feedback on learner submissions.',
    icon: 'ri-edit-line',
    pagePath: '/coach/marking-queue',
    role: 'coach',
    steps: [
      { step: 1, title: 'View Your Marking Queue', description: 'The marking queue shows all submissions awaiting your review. Each item shows the learner, module, component, submission date, and type (Assignment, Evidence, Quiz).', icon: 'ri-list-check' },
      { step: 2, title: 'Filter by Type or Priority', description: 'Use the filter tabs (All, Assignments, Evidence, Quizzes, Overdue) to focus on specific submission types. Overdue items are flagged in red and need immediate attention.', icon: 'ri-filter-3-line', action: 'Click a filter tab' },
      { step: 3, title: 'Start Marking', description: 'Click "Mark Now" on any submission to open the marking interface. You will see the learner\'s submission, the rubric, and space for your feedback and grade.', icon: 'ri-edit-line', action: 'Click Mark Now' },
      { step: 4, title: 'Use the Rubric', description: 'The marking rubric shows criteria and grade descriptors. Select a grade for each criterion. The overall grade is calculated automatically based on your selections.', icon: 'ri-file-list-3-line' },
      { step: 5, title: 'Write Feedback', description: 'Provide detailed feedback in the comment box. Be specific about what was good and what needs improvement. Use the AI suggestion panel for a starting point.', icon: 'ri-chat-1-line', tip: 'Constructive feedback is more valuable than grades. Focus on actionable next steps.' },
      { step: 6, title: 'Link to KSBs', description: 'During marking, you can link the submission to KSBs. If the evidence demonstrates a KSB, mark it as "Validated". If not, explain what is missing.', icon: 'ri-link', action: 'Select KSBs in the marking panel' },
      { step: 7, title: 'Submit Marks and Feedback', description: 'Click "Submit Mark" when finished. The learner will receive a notification and can view their grade, feedback, and KSB status updates.', icon: 'ri-check-double-line', action: 'Click Submit Mark' },
    ],
  },
  {
    id: 'coach-meetings',
    title: 'Coaching Meetings',
    description: 'Schedule, manage, and record coaching sessions and progress reviews.',
    icon: 'ri-calendar-check-line',
    pagePath: '/coach/meetings',
    role: 'coach',
    steps: [
      { step: 1, title: 'View Your Meeting Calendar', description: 'The meetings page shows a calendar view of all your coaching sessions, progress reviews, and employer meetings. Click any day to see scheduled meetings.', icon: 'ri-calendar-line' },
      { step: 2, title: 'Schedule a New Meeting', description: 'Click "Schedule Meeting" to create a new session. Choose the learner, meeting type (Monthly Coaching, Progress Review, Employer Meeting), date, time, and platform.', icon: 'ri-add-line', action: 'Click Schedule Meeting' },
      { step: 3, title: 'Set Meeting Type', description: 'Select the correct meeting type: Monthly Coaching (1:1), Progress Review (tripartite with employer), or Employer Meeting (check-in). Each type has different templates and requirements.', icon: 'ri-list-check' },
      { step: 4, title: 'Send Invites', description: 'After scheduling, click "Send Invites" to email the learner and/or employer. The invite includes the Teams link, agenda, and any pre-reading materials.', icon: 'ri-mail-send-line', action: 'Click Send Invites' },
      { step: 5, title: 'Record Meeting Notes', description: 'After the meeting, click "Add Notes" to record what was discussed. Use the template to cover: progress, barriers, OTJH, KSBs, next steps, and actions.', icon: 'ri-file-text-line', action: 'Click Add Notes' },
      { step: 6, title: 'Set Actions and Follow-ups', description: 'In the meeting notes, set specific actions for the learner, employer, and yourself. Each action gets a due date and is tracked in the action log.', icon: 'ri-task-line', tip: 'Actions are automatically added to the learner\'s This Week page.' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // TUTOR GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'tutor-dashboard',
    title: 'Tutor Dashboard',
    description: 'Your teaching hub for sessions, marking, evidence validation, and learner support.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/tutor',
    role: 'tutor',
    steps: [
      { step: 1, title: 'Welcome to Your Tutor Dashboard', description: 'When you log in, you will see your upcoming teaching sessions, marking queue, evidence reviews, and KSB validation tasks. This is your starting point for each day.', icon: 'ri-home-line' },
      { step: 2, title: 'View Upcoming Sessions', description: 'The Teaching Sessions card shows your upcoming live sessions, workshops, and webinars. Click to view session details, materials, and attendee list.', icon: 'ri-presentation-line', action: 'Navigate to Sessions' },
      { step: 3, title: 'Check Your Marking Queue', description: 'The Marking Queue shows assignments and quizzes awaiting review. The number badge indicates the total count. Click to start marking.', icon: 'ri-edit-line', action: 'Navigate to Assignment Marking' },
      { step: 4, title: 'Review Evidence Submissions', description: 'The Evidence Review card shows learner evidence awaiting validation. Click to review evidence, link to KSBs, and provide validation feedback.', icon: 'ri-file-search-line', action: 'Navigate to Evidence Review' },
      { step: 5, title: 'Validate KSBs', description: 'The KSB Validation card shows KSBs that have evidence submitted but not yet validated. Click to review evidence and confirm validation.', icon: 'ri-checkbox-circle-line', action: 'Navigate to KSB Validation' },
      { step: 6, title: 'Check Feedback Queue', description: 'The Feedback Queue shows learners awaiting your feedback on their work. Click to review and provide detailed feedback.', icon: 'ri-chat-3-line', action: 'Navigate to Feedback Queue' },
    ],
  },
  {
    id: 'tutor-sessions',
    title: 'Teaching Sessions',
    description: 'Plan, deliver, and manage your live teaching sessions.',
    icon: 'ri-presentation-line',
    pagePath: '/tutor/sessions',
    role: 'tutor',
    steps: [
      { step: 1, title: 'View Your Session Calendar', description: 'The sessions page shows a calendar view of all your teaching sessions. Each session is colour-coded by type: Live Session, Workshop, Webinar, or Q&A.', icon: 'ri-calendar-line' },
      { step: 2, title: 'Create a New Session', description: 'Click "Create Session" to plan a new teaching session. Enter the title, module, date, time, platform (Teams/Zoom), and upload session materials (slides, handouts).', icon: 'ri-add-line', action: 'Click Create Session' },
      { step: 3, title: 'Upload Session Materials', description: 'Before the session, upload all materials: slides, handouts, recordings from previous sessions, and any reading links. Learners can access these before the session.', icon: 'ri-upload-line', tip: 'Upload materials at least 24 hours before the session so learners can prepare.' },
      { step: 4, title: 'Manage Attendance', description: 'During or after the session, mark attendance. Click each learner\'s name to mark Present, Absent, or Excused. The attendance data feeds into the learner\'s attendance record.', icon: 'ri-check-double-line', action: 'Mark attendance' },
      { step: 5, title: 'Record and Upload Session Recording', description: 'After the session, upload the recording to the platform. Learners who missed the session or want to review can access it from the Catch-up section.', icon: 'ri-video-line', action: 'Upload recording' },
      { step: 6, title: 'Set Post-Session Tasks', description: 'After the session, set any follow-up tasks or quizzes. These appear on the learners\' This Week pages as new components.', icon: 'ri-task-line' },
    ],
  },
  {
    id: 'tutor-evidence',
    title: 'Evidence Review & Validation',
    description: 'Review learner evidence, validate KSBs, and provide feedback.',
    icon: 'ri-file-search-line',
    pagePath: '/tutor/evidence-review',
    role: 'tutor',
    steps: [
      { step: 1, title: 'View Evidence Queue', description: 'The evidence review page shows all submitted evidence awaiting validation. Each item shows the learner, title, linked KSBs, submission date, and type.', icon: 'ri-list-check' },
      { step: 2, title: 'Open Evidence for Review', description: 'Click "Review" to open the evidence. You will see the uploaded file, the learner\'s description, and the KSBs they have linked.', icon: 'ri-eye-line', action: 'Click Review' },
      { step: 3, title: 'Evaluate the Evidence', description: 'Ask: Does this evidence demonstrate the KSB? Is it sufficient? Is it authentic? Use the evaluation checklist to assess each criterion.', icon: 'ri-check-double-line' },
      { step: 4, title: 'Validate or Reject KSBs', description: 'For each linked KSB, click "Validate" if the evidence is sufficient, or "Reject" if it needs more work. When rejecting, explain clearly what is missing or needs improvement.', icon: 'ri-checkbox-circle-line', action: 'Click Validate or Reject' },
      { step: 5, title: 'Write Validation Feedback', description: 'Provide clear, constructive feedback. If validated, explain why it meets the standard. If rejected, explain exactly what the learner needs to do to improve.', icon: 'ri-chat-1-line', tip: 'Specific feedback is more helpful than generic comments. Quote the part of the evidence that demonstrates the KSB.' },
      { step: 6, title: 'Submit Validation', description: 'Click "Submit Validation" to confirm your decisions. The learner will be notified and can see your feedback and KSB status updates.', icon: 'ri-send-plane-line', action: 'Click Submit Validation' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // EMPLOYER GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'employer-dashboard',
    title: 'Employer Dashboard',
    description: 'Track your apprentice\'s progress, review actions, and manage confirmations.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/employer',
    role: 'employer',
    steps: [
      { step: 1, title: 'Welcome to Your Employer Dashboard', description: 'When you log in, your dashboard shows your apprentice\'s overview, progress, actions required, and upcoming reviews. This is your main view for apprenticeship oversight.', icon: 'ri-home-line' },
      { step: 2, title: 'View Apprentice Progress', description: 'The Apprentice Progress card shows the current programme status, overall KSB percentage, OTJH hours, and attendance rate. Click for detailed progress.', icon: 'ri-bar-chart-line', action: 'Navigate to Apprentice Progress' },
      { step: 3, title: 'Check Actions Required', description: 'The Actions Required section shows documents to sign, workplace confirmations, OTJH confirmations, and review actions. Click any item to complete it.', icon: 'ri-alert-line', action: 'Navigate to Actions Required' },
      { step: 4, title: 'Review Progress Reports', description: 'The Progress Reviews section shows upcoming and completed tripartite reviews. Click to view the agenda, previous meeting notes, and preparation materials.', icon: 'ri-file-chart-line', action: 'Navigate to Progress Reviews' },
      { step: 5, title: 'View KSB Progress', description: 'The KSB Progress card shows which Knowledge, Skills, and Behaviours your apprentice has demonstrated. Click to see detailed evidence and validation status.', icon: 'ri-bar-chart-2-line', action: 'Navigate to KSB Progress' },
      { step: 6, title: 'Access the Employer Community', description: 'The Employer Clubs section shows community forums, events, and networking opportunities with other employers. Click to join discussions or RSVP to events.', icon: 'ri-team-line', action: 'Navigate to Employer Clubs' },
    ],
  },
  {
    id: 'employer-actions',
    title: 'Actions Required',
    description: 'Complete documents, confirmations, and reviews for your apprentice.',
    icon: 'ri-alert-line',
    pagePath: '/employer/review-actions',
    role: 'employer',
    steps: [
      { step: 1, title: 'View Your Action List', description: 'The Actions Required page shows all pending items that need your attention. Each item has a due date, priority, and type. Click any item to complete it.', icon: 'ri-list-check' },
      { step: 2, title: 'Sign Documents', description: 'The Documents to Sign section shows training agreements, policies, and declarations. Click "Sign Now" to read the document and add your digital signature.', icon: 'ri-pen-nib-line', action: 'Click Sign Now' },
      { step: 3, title: 'Confirm Workplace Details', description: 'The Workplace Confirmations section requires you to confirm your apprentice\'s job role, working hours, and supervision arrangements. Click "Confirm" to complete.', icon: 'ri-building-line', action: 'Click Confirm' },
      { step: 4, title: 'Confirm OTJH Hours', description: 'The OTJH Confirmations section shows your apprentice\'s logged off-the-job hours. Review each entry and click "Confirm" or "Query" if you have questions.', icon: 'ri-time-line', action: 'Click Confirm or Query' },
      { step: 5, title: 'Complete Review Actions', description: 'After each progress review, you may have actions to complete (e.g., confirm a training plan change, sign a progress report). Click "Complete" to finish these.', icon: 'ri-file-chart-line', action: 'Click Complete' },
      { step: 6, title: 'Track Completed Actions', description: 'Click the "Completed" tab to see all actions you have completed. This is useful for audit purposes and to check your own compliance.', icon: 'ri-check-double-line', action: 'Click Completed tab' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // COMPLIANCE / ENROLMENT GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'compliance-dashboard',
    title: 'Enrolment Workspace',
    description: 'Manage onboarding, eligibility, assessments, and compliance readiness.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/compliance',
    role: 'compliance',
    steps: [
      { step: 1, title: 'Welcome to the Enrolment Workspace', description: 'When you log in, the dashboard shows the onboarding pipeline, new starters, eligibility reviews, and compliance alerts. This is your command centre for learner onboarding.', icon: 'ri-home-line' },
      { step: 2, title: 'Track the Onboarding Pipeline', description: 'The Onboarding Journey card shows learners in each stage: Pre-Active, Self-Onboarding, Employer Contracting, Enrolment Review, Eligibility, and Initial Assessment.', icon: 'ri-road-map-line', action: 'Navigate to Onboarding Journey' },
      { step: 3, title: 'Review New Starters', description: 'The New Starters card shows recently enrolled learners. Click to view their details, check missing information, and send welcome communications.', icon: 'ri-user-add-line', action: 'Navigate to New Starters' },
      { step: 4, title: 'Check Employer Contracting', description: 'The Employer Contracting section shows agreements awaiting employer signatures. Click to view contract status, send reminders, and track completion.', icon: 'ri-file-text-line', action: 'Navigate to Employer Contracting' },
      { step: 5, title: 'Review Eligibility', description: 'The Eligibility card shows learners awaiting eligibility checks. Click to verify age, residency, prior attainment, and funding eligibility.', icon: 'ri-checkbox-circle-line', action: 'Navigate to Eligibility' },
      { step: 6, title: 'Run Initial Assessments', description: 'The Initial Assessment section shows BKSB results, learning style assessments, and readiness scores. Click to review and confirm initial assessment outcomes.', icon: 'ri-clipboard-line', action: 'Navigate to Initial Assessment' },
      { step: 7, title: 'Monitor Compliance Alerts', description: 'The Compliance Alerts section shows DAS tracker issues, ILR readiness, funding risks, and Aptem sync errors. Click any alert to investigate and resolve.', icon: 'ri-alert-line', action: 'Navigate to Compliance Alerts' },
    ],
  },
  {
    id: 'compliance-enrolment',
    title: 'Enrolment Review',
    description: 'Review and approve learner enrolments before they go active.',
    icon: 'ri-search-eye-line',
    pagePath: '/compliance/enrolment-review',
    role: 'compliance',
    steps: [
      { step: 1, title: 'View Enrolment Queue', description: 'The enrolment review page shows all learners awaiting final approval. Each learner shows their stage, missing items, and review status.', icon: 'ri-list-check' },
      { step: 2, title: 'Open a Learner Review', description: 'Click "Review" to open a learner\'s full enrolment record. This shows all documents, eligibility checks, assessments, and employer confirmations.', icon: 'ri-eye-line', action: 'Click Review' },
      { step: 3, title: 'Check the Review Checklist', description: 'The checklist shows all required items: Personal Details, Eligibility, Initial Assessment, Employer Contracting, Documents, and Signatures. Each item must be green before approval.', icon: 'ri-check-double-line' },
      { step: 4, title: 'Review Documents', description: 'Click the Documents tab to view all uploaded files: ID, certificates, employer agreement, training plan. Check for completeness and validity.', icon: 'ri-folder-line' },
      { step: 5, title: 'Confirm or Reject', description: 'If all items are complete, click "Confirm Enrolment". If any items are missing or incorrect, click "Reject" and explain what needs to be fixed. The learner\'s coach will be notified.', icon: 'ri-check-double-line', action: 'Click Confirm Enrolment or Reject' },
      { step: 6, title: 'Send Welcome Communication', description: 'After confirming, click "Send Welcome" to send the learner their onboarding pack, login details, and welcome message.', icon: 'ri-mail-send-line', action: 'Click Send Welcome' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // ADMIN GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'admin-dashboard',
    title: 'Super Admin Workspace',
    description: 'Manage the platform, users, tenants, and system configuration.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/admin',
    role: 'admin',
    steps: [
      { step: 1, title: 'Welcome to the Super Admin Workspace', description: 'When you log in, you will see platform overview stats: total users, active tenants, system health, and recent alerts. This is your central command for the entire platform.', icon: 'ri-home-line' },
      { step: 2, title: 'Manage Users', description: 'The Users card shows total platform users, new sign-ups, and role distribution. Click to access the user management page where you can add, edit, or deactivate users.', icon: 'ri-user-settings-line', action: 'Navigate to Users' },
      { step: 3, title: 'Manage Tenants', description: 'The Tenants section shows all organisations on the platform. Click to view tenant details, manage their settings, and monitor their usage.', icon: 'ri-building-4-line', action: 'Navigate to Tenants' },
      { step: 4, title: 'Configure Platform Settings', description: 'The Platform Configuration section shows forms, templates, automations, and notifications. Click to access each area and modify platform-wide settings.', icon: 'ri-settings-4-line', action: 'Navigate to Settings' },
      { step: 5, title: 'Review System Health', description: 'The System Health section shows server status, database performance, API response times, and any error logs. Investigate any red alerts immediately.', icon: 'ri-heart-pulse-line', action: 'Navigate to System' },
      { step: 6, title: 'Check Audit Logs', description: 'The Audit Logs card shows recent platform activity: user logins, data changes, and system events. Click to view the full audit trail for compliance.', icon: 'ri-history-line', action: 'Navigate to Audit Logs' },
    ],
  },
  {
    id: 'admin-users',
    title: 'User Management',
    description: 'Add, edit, deactivate, and manage platform users and their roles.',
    icon: 'ri-user-settings-line',
    pagePath: '/admin/users',
    role: 'admin',
    steps: [
      { step: 1, title: 'View the User List', description: 'The Users page shows all platform users. Each row shows name, email, role, tenant, status, and last login. Use the search bar to find specific users.', icon: 'ri-list-check' },
      { step: 2, title: 'Add a New User', description: 'Click "Add User" to create a new account. Enter their name, email, role, and tenant. The system will send a welcome email with login instructions.', icon: 'ri-user-add-line', action: 'Click Add User' },
      { step: 3, title: 'Edit User Details', description: 'Click the "Edit" icon on any user row to modify their details: name, email, role, permissions, or tenant. Some changes may require the user to re-login.', icon: 'ri-edit-line', action: 'Click Edit icon' },
      { step: 4, title: 'Manage Roles and Permissions', description: 'The Roles tab shows all system roles. Click any role to view its permissions. You can create custom roles or modify existing ones. Changes apply immediately.', icon: 'ri-shield-check-line', action: 'Navigate to Roles tab' },
      { step: 5, title: 'Deactivate or Delete Users', description: 'Click "Deactivate" to disable a user\'s account without deleting their data. Click "Delete" to permanently remove the user. Deactivation is reversible; deletion is not.', icon: 'ri-delete-bin-line', tip: 'Deactivate instead of delete for audit trail compliance. Only delete when legally required.' },
      { step: 6, title: 'Bulk Import Users', description: 'Click "Bulk Import" to upload a CSV file with multiple users. Use the template provided. The system will validate the file and create accounts for all valid rows.', icon: 'ri-file-upload-line', action: 'Click Bulk Import' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // QA GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'qa-dashboard',
    title: 'QA Review Centre',
    description: 'Conduct quality assurance reviews across onboarding, delivery, and evidence.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/qa',
    role: 'qa',
    steps: [
      { step: 1, title: 'Welcome to the QA Review Centre', description: 'When you log in, the dashboard shows QA queues: Onboarding, Curriculum, Evidence, Reviews, and Operations. Each shows the count of items awaiting review.', icon: 'ri-home-line' },
      { step: 2, title: 'Review Onboarding Quality', description: 'The Onboarding QA card shows learners in the onboarding pipeline with quality checks. Click to review eligibility checks, initial assessments, and employer contracting.', icon: 'ri-user-received-line', action: 'Navigate to Onboarding QA' },
      { step: 3, title: 'Review Curriculum Quality', description: 'The Curriculum QA card shows modules, assessments, and delivery plans awaiting review. Click to check curriculum alignment with standards, KSB mapping, and assessment validity.', icon: 'ri-stack-line', action: 'Navigate to Curriculum QA' },
      { step: 4, title: 'Review Learner Evidence', description: 'The Evidence QA card shows submitted evidence, OTJH records, and KSB validations awaiting QA review. Click to sample and verify quality and consistency.', icon: 'ri-folder-upload-line', action: 'Navigate to Evidence QA' },
      { step: 5, title: 'Run Sampling', description: 'The Sampling section allows you to set up random or targeted sampling of cases, evidence, or sessions. Click to configure sampling rules and generate sample lists.', icon: 'ri-pie-chart-2-line', action: 'Navigate to Sampling' },
      { step: 6, title: 'Review QA Findings', description: 'The QA Findings section shows all identified issues, recommendations, and action plans. Click to view findings, assign owners, and track resolution.', icon: 'ri-search-eye-line', action: 'Navigate to Findings' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // LEADERSHIP GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'leadership-dashboard',
    title: 'Leadership Intelligence Centre',
    description: 'Strategic oversight of performance, engagement, compliance, and quality.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/leadership',
    role: 'leadership',
    steps: [
      { step: 1, title: 'Welcome to the Leadership Intelligence Centre', description: 'When you log in, you will see strategic overview dashboards: Cohort Performance, Programme Performance, Attendance, Engagement, and Compliance Risk. This is your executive view.', icon: 'ri-home-line' },
      { step: 2, title: 'Review Cohort Performance', description: 'The Cohort Performance card shows completion rates, pass rates, and average progress across all cohorts. Click to drill down into specific cohorts, programmes, or time periods.', icon: 'ri-group-line', action: 'Navigate to Cohort Performance' },
      { step: 3, title: 'Check Engagement Trends', description: 'The Engagement Trends card shows learner engagement scores, attendance, club participation, and reward activity. Click to see trends and identify at-risk patterns.', icon: 'ri-heart-pulse-line', action: 'Navigate to Engagement Trends' },
      { step: 4, title: 'Monitor Compliance Risk', description: 'The Compliance Risk card shows funding risk, audit status, ILR accuracy, and DAS tracker health. Click to view the full compliance risk dashboard.', icon: 'ri-shield-line', action: 'Navigate to Compliance Risk' },
      { step: 5, title: 'Review Staff Performance', description: 'The Staff & Delivery section shows tutor SLA, coach workload, and delivery performance. Click to view individual staff metrics and workload distribution.', icon: 'ri-team-line', action: 'Navigate to Tutor SLA or Coach Workload' },
      { step: 6, title: 'Generate Reports', description: 'The Reports section allows you to generate custom reports for Ofsted, SAR/QIP, or internal review. Click to select the report type, date range, and filters.', icon: 'ri-bar-chart-box-line', action: 'Navigate to Reports' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // CURRICULUM GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'curriculum-dashboard',
    title: 'Curriculum Studio',
    description: 'Design, build, and manage curriculum, modules, assessments, and delivery plans.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/curriculum',
    role: 'curriculum',
    steps: [
      { step: 1, title: 'Welcome to the Curriculum Studio', description: 'When you log in, you will see the curriculum dashboard: Programmes, Standards, Builders, Assessments, and Quality. This is your design studio for all learning content.', icon: 'ri-home-line' },
      { step: 2, title: 'Design Programmes', description: 'The Programmes section shows all learning programmes. Click to create a new programme, edit an existing one, or view its structure (modules, weeks, components).', icon: 'ri-stack-line', action: 'Navigate to Programmes' },
      { step: 3, title: 'Build Modules', description: 'The Module Builder allows you to create modules with titles, descriptions, learning outcomes, KSB mappings, and week structures. Click to start building.', icon: 'ri-layout-4-line', action: 'Navigate to Module Builder' },
      { step: 4, title: 'Map KSBs', description: 'The KSB Mapping section shows the KSB framework for each standard. Click to link KSBs to modules, components, and assessments. This mapping drives the learner tracker.', icon: 'ri-link', action: 'Navigate to KSB Mapping' },
      { step: 5, title: 'Create Assessments', description: 'The Assessment Design section shows the Quiz Workspace, Question Bank, and Checkpoints. Click to create quiz questions, reuse saved questions, and design checkpoint assessments.', icon: 'ri-question-answer-line', action: 'Navigate to Quiz Workspace or Question Bank' },
      { step: 6, title: 'Publish Curriculum', description: 'The Quality & Publishing section shows version control, QA status, and published curriculum. Click to review, approve, and publish curriculum to production.', icon: 'ri-book-open-line', action: 'Navigate to Published' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // MIS GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'mis-dashboard',
    title: 'MIS Operations Centre',
    description: 'Manage cohorts, timetables, allocations, and data quality.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/mis',
    role: 'mis',
    steps: [
      { step: 1, title: 'Welcome to the MIS Operations Centre', description: 'When you log in, you will see the MIS dashboard: Cohorts, Timetables, Allocations, and Data Quality. This is your operations hub for delivery logistics.', icon: 'ri-home-line' },
      { step: 2, title: 'Manage Cohorts', description: 'The Cohorts section shows all active cohorts. Click to view cohort details, learner lists, programme assignments, and delivery schedules.', icon: 'ri-group-line', action: 'Navigate to Cohorts' },
      { step: 3, title: 'Build Timetables', description: 'The Timetables section shows session calendars, room bookings, and tutor assignments. Click to create or modify timetables, assign sessions, and manage conflicts.', icon: 'ri-calendar-line', action: 'Navigate to Timetables' },
      { step: 4, title: 'Allocate Learners', description: 'The Learner Allocation section shows learners awaiting cohort assignment. Click to assign learners to cohorts, programmes, and coaches based on their details and availability.', icon: 'ri-user-add-line', action: 'Navigate to Learner Allocation' },
      { step: 5, title: 'Assign Staff', description: 'The Staff Assignment section shows coach and tutor assignments. Click to assign coaches to learners, tutors to modules, and manage workload balancing.', icon: 'ri-user-settings-line', action: 'Navigate to Coach or Tutor Assignment' },
      { step: 6, title: 'Check Data Quality', description: 'The Data Quality section shows data accuracy, completeness, and consistency issues. Click to review flagged records, correct errors, and run data quality reports.', icon: 'ri-database-2-line', action: 'Navigate to Data Quality' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // SUPPORT GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'support-dashboard',
    title: 'Support Centre',
    description: 'Manage support tickets, escalations, and knowledge base.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/support',
    role: 'support',
    steps: [
      { step: 1, title: 'Welcome to the Support Centre', description: 'When you log in, you will see the support dashboard: Ticket Queue, My Tickets, Escalations, and Knowledge Base. This is your hub for managing all support requests.', icon: 'ri-home-line' },
      { step: 2, title: 'View the Ticket Queue', description: 'The Ticket Queue shows all open support tickets. Each ticket shows priority, category, submitter, and status. Click any ticket to open and respond.', icon: 'ri-ticket-line', action: 'Navigate to Ticket Queue' },
      { step: 3, title: 'Respond to a Ticket', description: 'Open a ticket to see the full description, previous messages, and any attachments. Write a response, set the status, and assign it to a team member if needed.', icon: 'ri-chat-1-line', action: 'Click Reply' },
      { step: 4, title: 'Manage Escalations', description: 'The Escalations section shows tickets that have been escalated or are high priority. Click to review, reassign, or resolve escalated items.', icon: 'ri-alert-line', action: 'Navigate to Escalations' },
      { step: 5, title: 'Update the Knowledge Base', description: 'The Knowledge Base section shows all FAQ articles and support guides. Click to add new articles, edit existing ones, or review which articles are most viewed.', icon: 'ri-book-read-line', action: 'Navigate to Knowledge Base' },
      { step: 6, title: 'Generate Reports', description: 'The Reports section shows ticket volume, resolution times, satisfaction scores, and team performance. Click to generate and export reports for management.', icon: 'ri-bar-chart-box-line', action: 'Navigate to Reports' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // ENGAGEMENT GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'engagement-dashboard',
    title: 'Engagement Command Centre',
    description: 'Monitor engagement, attendance, rewards, and community activity.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/engagement',
    role: 'engagement',
    steps: [
      { step: 1, title: 'Welcome to the Engagement Command Centre', description: 'When you log in, you will see the engagement dashboard: Learner Monitoring, Attendance, Rewards, and Community. This is your hub for learner engagement and retention.', icon: 'ri-home-line' },
      { step: 2, title: 'Monitor Learner Engagement', description: 'The Learner Engagement card shows engagement scores, activity levels, and risk indicators. Click to drill down into individual learners and their activity patterns.', icon: 'ri-heart-line', action: 'Navigate to Learner Engagement' },
      { step: 3, title: 'Track Attendance Risk', description: 'The Attendance Risk section shows learners with declining attendance, missed sessions, and catch-up overdue. Click to view detailed attendance reports and trigger interventions.', icon: 'ri-alert-line', action: 'Navigate to Attendance Risk' },
      { step: 4, title: 'Manage Rewards and Recognition', description: 'The Rewards section shows the points rules, rewards shop, and recognition pages. Click to configure point rules, add rewards, and review recognition nominations.', icon: 'ri-trophy-line', action: 'Navigate to Points Rules or Rewards Shop' },
      { step: 5, title: 'Manage Clubs and Events', description: 'The Community section shows learner clubs, employer clubs, and events. Click to create new events, manage club memberships, and review activity levels.', icon: 'ri-team-line', action: 'Navigate to Clubs or Events' },
      { step: 6, title: 'Review Communication Logs', description: 'The Communication Hub shows call logs, email logs, WhatsApp logs, and employer escalations. Click to review communication history and ensure no learner is missed.', icon: 'ri-message-2-line', action: 'Navigate to Communication Centre' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // FINANCE GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'finance-dashboard',
    title: 'Finance Workspace',
    description: 'Manage funding, invoicing, payments, and budgets.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/finance',
    role: 'finance',
    steps: [
      { step: 1, title: 'Welcome to the Finance Workspace', description: 'When you log in, you will see the finance dashboard: Funding Overview, Invoicing, Payments, and Budgets. This is your hub for all financial operations.', icon: 'ri-home-line' },
      { step: 2, title: 'Review Funding Overview', description: 'The Funding Overview shows total funding allocated, drawn down, and remaining. It shows breakdown by programme, employer, and cohort. Click to view details.', icon: 'ri-money-pound-circle-line', action: 'Navigate to Funding Overview' },
      { step: 3, title: 'Manage Invoices', description: 'The Invoicing section shows all invoices: generated, sent, paid, and overdue. Click to create new invoices, send reminders, and track payment status.', icon: 'ri-bill-line', action: 'Navigate to Invoicing' },
      { step: 4, title: 'Track Payments', description: 'The Payments section shows all received payments, reconciliations, and pending transactions. Click to view payment history, match payments to invoices, and handle discrepancies.', icon: 'ri-money-pound-circle-line', action: 'Navigate to Payments' },
      { step: 5, title: 'Manage Budgets', description: 'The Budgets section shows budget allocations by department, programme, and cost centre. Click to create budgets, track spending, and run variance reports.', icon: 'ri-pie-chart-2-line', action: 'Navigate to Budgets' },
      { step: 6, title: 'Generate Financial Reports', description: 'The Reports section shows funding reports, income statements, and reconciliation reports. Click to select the report type, date range, and export format.', icon: 'ri-bar-chart-box-line', action: 'Navigate to Reports' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // AUDITOR GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'auditor-dashboard',
    title: 'Auditor Workspace',
    description: 'Conduct evidence sampling, audit trails, compliance review, and Ofsted preparation.',
    icon: 'ri-dashboard-line',
    pagePath: '/workspace/auditor',
    role: 'auditor',
    steps: [
      { step: 1, title: 'Welcome to the Auditor Workspace', description: 'When you log in, you will see the auditor dashboard: Evidence Samples, Audit Trail, Compliance Review, and Ofsted Pack. This is your hub for all audit activities.', icon: 'ri-home-line' },
      { step: 2, title: 'Sample Evidence', description: 'The Evidence Sample section shows random or targeted samples of learner evidence, KSB validations, and OTJH records. Click to review and verify quality.', icon: 'ri-folder-open-line', action: 'Navigate to Evidence Sample' },
      { step: 3, title: 'Review Audit Trail', description: 'The Audit Trail shows all system actions: user logins, data changes, approvals, and rejections. Click to filter by date range, user, or action type.', icon: 'ri-history-line', action: 'Navigate to Audit Trail' },
      { step: 4, title: 'Run Compliance Review', description: 'The Compliance Review section shows eligibility checks, funding compliance, ILR accuracy, and DAS alignment. Click to run compliance checks and identify issues.', icon: 'ri-shield-check-line', action: 'Navigate to Compliance Review' },
      { step: 5, title: 'Prepare Ofsted Pack', description: 'The Ofsted Pack section shows all documents and evidence required for inspection. Click to review, generate the pack, and ensure everything is up to date.', icon: 'ri-government-line', action: 'Navigate to Ofsted Pack' },
      { step: 6, title: 'Generate Audit Reports', description: 'The Reports section allows you to generate audit findings, risk assessments, and compliance summaries. Click to create and export reports.', icon: 'ri-bar-chart-box-line', action: 'Navigate to Reports' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // SAFEGUARDING GUIDES
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'safeguarding-dashboard',
    title: 'Safeguarding Workspace',
    description: 'Manage safeguarding cases, wellbeing, referrals, and risk assessments.',
    icon: 'ri-shield-line',
    pagePath: '/workspace/safeguarding',
    role: 'safeguarding',
    steps: [
      { step: 1, title: 'Welcome to the Safeguarding Workspace', description: 'When you log in, you will see the safeguarding dashboard: Open Cases, New Concerns, High-Risk Cases, and Wellbeing. This is a restricted workspace for safeguarding officers only.', icon: 'ri-home-line' },
      { step: 2, title: 'Review Open Cases', description: 'The Open Cases section shows all active safeguarding cases. Each case shows the learner, concern type, risk level, assigned officer, and last action. Click to open a case.', icon: 'ri-folder-open-line', action: 'Navigate to Open Cases' },
      { step: 3, title: 'Log New Concerns', description: 'The New Concerns section shows recently reported concerns. Click to review, assess risk, and either close or escalate to a formal case. All concerns must be logged within 24 hours.', icon: 'ri-alert-line', action: 'Navigate to New Concerns' },
      { step: 4, title: 'Monitor High-Risk Cases', description: 'The High-Risk Cases section shows cases with severe risk ratings. These require immediate action and daily review. Click to see the full risk assessment and action plan.', icon: 'ri-error-warning-line', action: 'Navigate to High-Risk Cases' },
      { step: 5, title: 'Review Learner Wellbeing', description: 'The Wellbeing section shows wellbeing concerns, support needs, and vulnerable learners. Click to review assessment scores, support plans, and follow-up actions.', icon: 'ri-heart-line', action: 'Navigate to Learner Wellbeing' },
      { step: 6, title: 'Manage Referrals and Escalations', description: 'The Referrals section shows internal escalations, external referrals, and employer concerns. Click to track referral status, outcomes, and ensure follow-through.', icon: 'ri-share-forward-line', action: 'Navigate to Referrals' },
    ],
  },
];

export function getGuidesForRole(role: string): GuideSection[] {
  return USER_GUIDES.filter(g => g.role === role);
}

export function getGuideForPage(role: string, pagePath: string): GuideSection | undefined {
  return USER_GUIDES.find(g => g.role === role && g.pagePath === pagePath);
}

export const ALL_ROLES = [
  { key: 'learner', label: 'Learner', icon: 'ri-user-line' },
  { key: 'coach', label: 'Coach', icon: 'ri-heart-line' },
  { key: 'tutor', label: 'Tutor', icon: 'ri-presentation-line' },
  { key: 'employer', label: 'Employer', icon: 'ri-building-2-line' },
  { key: 'compliance', label: 'Enrolment Officer', icon: 'ri-checkbox-circle-line' },
  { key: 'admin', label: 'Super Admin', icon: 'ri-shield-user-line' },
  { key: 'qa', label: 'QA Officer', icon: 'ri-shield-check-line' },
  { key: 'leadership', label: 'Senior Leadership', icon: 'ri-bar-chart-box-line' },
  { key: 'curriculum', label: 'Curriculum Designer', icon: 'ri-stack-line' },
  { key: 'mis', label: 'MIS Operations', icon: 'ri-database-2-line' },
  { key: 'support', label: 'Support', icon: 'ri-customer-service-2-line' },
  { key: 'engagement', label: 'Engagement Manager', icon: 'ri-heart-pulse-line' },
  { key: 'finance', label: 'Finance', icon: 'ri-money-pound-circle-line' },
  { key: 'auditor', label: 'Auditor', icon: 'ri-file-search-line' },
  { key: 'safeguarding', label: 'Safeguarding', icon: 'ri-shield-line' },
];
