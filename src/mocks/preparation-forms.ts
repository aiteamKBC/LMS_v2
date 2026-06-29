export const PREPARATION_FORMS_DATA: {
  id: string;
  learnerName: string;
  learnerInitials: string;
  programme: string;
  reviewTitle: string;
  reviewDate: string;
  submittedAt: string;
  status: 'new' | 'reviewed' | 'done';
  coachComment: string | null;
  responses: { question: string; answer: string }[];
}[] = [
  {
    id: 'pf-1',
    learnerName: 'Sophie Williams',
    learnerInitials: 'SW',
    programme: 'Marketing Executive L4',
    reviewTitle: 'June Progress Review',
    reviewDate: '25 June 2026',
    submittedAt: '2026-06-16T14:32:00Z',
    status: 'new',
    coachComment: null,
    responses: [
      { question: 'What have you achieved since the last review?', answer: 'I completed the Customer Persona Activity and submitted the Competitor Analysis. I have also increased my OTJH logging from 62 to 74 hours and actively applied marketing concepts during store promotions.' },
      { question: 'Which KSBs have you developed?', answer: 'K6 — Marketing Planning through the Competitor Analysis. S7 — Persona Development via the customer profiling exercise. B2 — Professional Behaviours in stakeholder communication with the store team.' },
      { question: 'How have you applied learning in your workplace?', answer: 'I led the social media planning for the summer promotional campaign. I also used customer segmentation techniques to improve targeting for local store promotions, which resulted in a 15% increase in engagement.' },
      { question: 'Which evidence are you most proud of?', answer: 'The Competitor Analysis report — it was detailed and received positive feedback from my line manager. I also compiled a portfolio of social media campaigns that demonstrates my practical application of marketing principles.' },
      { question: 'What barriers are affecting your progress?', answer: 'Finding consistent time to log OTJH during busy periods at the store. Also, some evidence items need manager sign-off but Lauren has been very supportive and responsive.' },
      { question: 'What support do you need?', answer: 'More structured time blocked during quieter shifts for learning activities and evidence documentation. Also, guidance on how to better organise evidence for the upcoming Gateway assessment.' },
      { question: 'What targets would you like to agree?', answer: 'Increase OTJH to 85 hours by next review. Submit 6 more evidence items covering K6 and S7. Complete the Digital Marketing Trends module and start preparing for Gateway readiness.' },
    ],
  },
  {
    id: 'pf-2',
    learnerName: 'James Okonkwo',
    learnerInitials: 'JO',
    programme: 'Data Analyst L4',
    reviewTitle: 'June Progress Review',
    reviewDate: '19 June 2026',
    submittedAt: '2026-06-15T09:15:00Z',
    status: 'reviewed',
    coachComment: 'Good reflection. Need to focus on evidence gaps.',
    responses: [
      { question: 'What have you achieved since the last review?', answer: 'Completed 3 data analysis modules and submitted the SQL query optimisation project. However, I struggled with attendance due to personal commitments and fell behind on evidence logging.' },
      { question: 'Which KSBs have you developed?', answer: 'K3 — Data Analysis Techniques through the SQL project. S4 — Statistical Methods via the regression analysis exercise. I need to work more on S5 — Data Visualisation.' },
      { question: 'How have you applied learning in your workplace?', answer: 'I applied the SQL optimisation techniques to improve our internal reporting queries, reducing runtime by 40%. I also introduced a new dashboard for tracking customer metrics.' },
      { question: 'Which evidence are you most proud of?', answer: 'The SQL query optimisation project — it had real measurable impact. I also created a data cleaning workflow that the team now uses regularly.' },
      { question: 'What barriers are affecting your progress?', answer: 'Personal commitments have affected my attendance. I have missed 2 sessions this month and my evidence count is low. I also find it hard to balance work deadlines with learning activities.' },
      { question: 'What support do you need?', answer: 'Catch-up sessions for missed modules. Help with structuring my evidence portfolio. Also need support communicating with my employer about protected learning time.' },
      { question: 'What targets would you like to agree?', answer: 'Catch up on missed sessions. Submit at least 8 evidence items. Improve attendance to 90%+. Complete the Data Visualisation module.' },
    ],
  },
  {
    id: 'pf-3',
    learnerName: 'Emily Watson',
    learnerInitials: 'EW',
    programme: 'Digital Marketer L3',
    reviewTitle: 'June Progress Review',
    reviewDate: '18 June 2026',
    submittedAt: '2026-06-17T08:45:00Z',
    status: 'new',
    coachComment: null,
    responses: [
      { question: 'What have you achieved since the last review?', answer: 'Completed all assigned modules ahead of schedule. Submitted 6 new evidence items including the SEO audit report and social media campaign analysis. OTJH is at 92 hours.' },
      { question: 'Which KSBs have you developed?', answer: 'K2 — Digital Marketing Principles through the SEO audit. S3 — Content Creation via the social media campaign. B1 — Professional Ethics in handling client data and GDPR compliance.' },
      { question: 'How have you applied learning in your workplace?', answer: 'I redesigned the company\'s Instagram strategy which increased engagement by 35%. I also implemented SEO best practices on the company blog resulting in better organic traffic.' },
      { question: 'Which evidence are you most proud of?', answer: 'The SEO audit report — it was comprehensive and led to actionable improvements. Also proud of the social media analytics dashboard I built for the team.' },
      { question: 'What barriers are affecting your progress?', answer: 'None significant. My employer is very supportive and provides dedicated learning time. The only challenge is occasionally balancing multiple campaign deadlines.' },
      { question: 'What support do you need?', answer: 'I would like to start discussing Gateway preparation. Also interested in exploring advanced digital marketing certifications beyond the apprenticeship.' },
      { question: 'What targets would you like to agree?', answer: 'Reach 100 OTJH. Submit all remaining evidence items. Begin Gateway readiness assessment. Explore EPA preparation resources.' },
    ],
  },
];

export const formatSubmissionTime = (isoString: string): { date: string; time: string; relative: string } => {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHrs / 24);

  let relative: string;
  if (diffHrs < 1) relative = 'Just now';
  else if (diffHrs < 24) relative = `${diffHrs}h ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else if (diffDays < 7) relative = `${diffDays}d ago`;
  else relative = `${diffDays}d ago`;

  return {
    date: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    relative,
  };
};