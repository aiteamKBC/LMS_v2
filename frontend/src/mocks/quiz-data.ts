/* ═══════════════════════════════════════════════════════════════
   QUIZ ASSESSMENT HUB — Mock Data
   ═══════════════════════════════════════════════════════════════ */

export interface QuizKSB {
  code: string;
  label: string;
  type: 'Knowledge' | 'Skill' | 'Behaviour';
}

export interface QuizHistoryEntry {
  date: string;
  score: number;
  passed: boolean;
  timeTaken: string;
}

export interface QuizItem {
  id: string;
  title: string;
  module: string;
  moduleId: string;
  weekRef: string;
  quizType: 'weekly' | 'monthly';
  description: string;
  questionCount: number;
  passMark: number;
  timeLimit: string;
  estimatedDuration: string;
  dueDate: string;
  status: 'Not Started' | 'In Progress' | 'Passed' | 'Failed' | 'Retake Required' | 'Locked' | 'Completed';
  latestScore: number | null;
  highestScore: number | null;
  attemptCount: number;
  ksbs: QuizKSB[];
  history: QuizHistoryEntry[];
  feedback?: string;
  areasForImprovement?: string[];
  unlockRequirement?: string;
  unlockModule?: string;
  expectedUnlockDate?: string;
  isPriority: boolean;
  priorityLabel?: string;
  retakeAllowed: boolean;
  retakeUntil?: string;
  pointsValue: number;
}

export interface RevisionRecommendation {
  id: string;
  title: string;
  whyRecommended: string;
  relatedKsbs: QuizKSB[];
  estimatedTime: string;
  resourceType: string;
  resourceHref: string;
  priority: 'High' | 'Medium' | 'Low';
}

export interface KnowledgeBadge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  earnedDate?: string;
  icon: string;
}

export const QUIZ_ITEMS: QuizItem[] = [
  {
    id: 'qz-01',
    title: 'Week 1 Knowledge Check: Induction',
    module: 'Apprenticeship Induction',
    moduleId: 'mod-01',
    weekRef: 'Week 1',
    quizType: 'weekly',
    description: 'Baseline assessment covering apprenticeship standards, platform navigation, and professional practice fundamentals.',
    questionCount: 8,
    passMark: 80,
    timeLimit: '10 mins',
    estimatedDuration: '10 mins',
    dueDate: '23 May 2026',
    status: 'Passed',
    latestScore: 95,
    highestScore: 95,
    attemptCount: 1,
    ksbs: [
      { code: 'B1', label: 'Proactively apply learning in the workplace', type: 'Behaviour' },
      { code: 'B2', label: 'Professional conduct and accountability', type: 'Behaviour' },
      { code: 'B4', label: 'Commitment to CPD and learning', type: 'Behaviour' },
    ],
    history: [
      { date: '23 May 2026', score: 95, passed: true, timeTaken: '8 mins' },
    ],
    feedback: 'Excellent baseline knowledge. Strong understanding of apprenticeship standards and professional expectations. Well prepared for the programme.',
    isPriority: false,
    retakeAllowed: true,
    retakeUntil: '30 May 2026',
    pointsValue: 8,
  },
  {
    id: 'qz-02',
    title: 'Week 2 Knowledge Check: Marketing Principles',
    module: 'Apprenticeship Induction',
    moduleId: 'mod-01',
    weekRef: 'Week 2',
    quizType: 'weekly',
    description: 'Foundational marketing concepts — marketing mix, business environment, and the role of marketing in organisations.',
    questionCount: 10,
    passMark: 80,
    timeLimit: '15 mins',
    estimatedDuration: '15 mins',
    dueDate: '30 May 2026',
    status: 'Passed',
    latestScore: 88,
    highestScore: 88,
    attemptCount: 1,
    ksbs: [
      { code: 'K1', label: 'The marketing environment and its impact on business', type: 'Knowledge' },
      { code: 'K3', label: 'The marketing mix and its application', type: 'Knowledge' },
    ],
    history: [
      { date: '30 May 2026', score: 88, passed: true, timeTaken: '12 mins' },
    ],
    feedback: 'Strong grasp of marketing fundamentals. The marketing mix questions were particularly well-answered. Review the business environment section to push toward 90%+.',
    isPriority: false,
    retakeAllowed: true,
    retakeUntil: '6 Jun 2026',
    pointsValue: 10,
  },
  {
    id: 'qz-03',
    title: 'Week 3 Knowledge Check: Marketing Environment',
    module: 'Apprenticeship Induction',
    moduleId: 'mod-01',
    weekRef: 'Week 3',
    quizType: 'weekly',
    description: 'PESTLE framework, competitor analysis, SWOT application, and the wider marketing environment.',
    questionCount: 10,
    passMark: 80,
    timeLimit: '15 mins',
    estimatedDuration: '15 mins',
    dueDate: '6 Jun 2026',
    status: 'Passed',
    latestScore: 92,
    highestScore: 92,
    attemptCount: 1,
    ksbs: [
      { code: 'K2', label: 'Environmental analysis — PESTLE, SWOT, and competitor analysis', type: 'Knowledge' },
      { code: 'K4', label: 'The impact of external factors on marketing strategy', type: 'Knowledge' },
      { code: 'K7', label: 'Market research methods and data collection', type: 'Knowledge' },
    ],
    history: [
      { date: '6 Jun 2026', score: 92, passed: true, timeTaken: '13 mins' },
    ],
    feedback: 'Very strong environmental analysis skills. The PESTLE application to real scenarios was particularly impressive. Your SWOT analysis understanding is solid.',
    isPriority: false,
    retakeAllowed: true,
    retakeUntil: '13 Jun 2026',
    pointsValue: 10,
  },
  {
    id: 'qz-04',
    title: 'Week 4 Knowledge Check: Segmentation and Targeting',
    module: 'Marketing Principles & Customer Insight',
    moduleId: 'mod-02',
    weekRef: 'Week 4',
    quizType: 'weekly',
    description: 'Customer segmentation fundamentals, targeting strategies, and the STP framework application.',
    questionCount: 12,
    passMark: 80,
    timeLimit: '15 mins',
    estimatedDuration: '15 mins',
    dueDate: '13 Jun 2026',
    status: 'Not Started',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
      { code: 'K6', label: 'Marketing planning frameworks and campaign development', type: 'Knowledge' },
    ],
    history: [],
    isPriority: true,
    priorityLabel: 'Due This Week',
    retakeAllowed: true,
    retakeUntil: '20 Jun 2026',
    pointsValue: 15,
  },
  {
    id: 'qz-05',
    title: 'Weekly Checkpoint: Consumer Behaviour',
    module: 'Marketing Principles & Customer Insight',
    moduleId: 'mod-02',
    weekRef: 'Week 5',
    quizType: 'weekly',
    description: 'Consumer decision-making models, psychological influences on buying behaviour, and customer journey mapping.',
    questionCount: 12,
    passMark: 80,
    timeLimit: '15 mins',
    estimatedDuration: '15 mins',
    dueDate: '20 Jun 2026',
    status: 'Not Started',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
      { code: 'K6', label: 'Marketing planning frameworks and campaign development', type: 'Knowledge' },
      { code: 'B1', label: 'Proactively apply learning in the workplace', type: 'Behaviour' },
    ],
    history: [],
    isPriority: false,
    retakeAllowed: true,
    retakeUntil: '27 Jun 2026',
    pointsValue: 12,
  },
  {
    id: 'qz-06',
    title: 'Monthly KSB Progress Quiz: Marketing Planning',
    module: 'Marketing Principles & Customer Insight',
    moduleId: 'mod-02',
    weekRef: 'Week 6',
    quizType: 'monthly',
    description: 'Comprehensive monthly assessment across all current module KSBs. Tests knowledge, application, and critical analysis of marketing planning concepts.',
    questionCount: 20,
    passMark: 70,
    timeLimit: '25 mins',
    estimatedDuration: '25 mins',
    dueDate: '27 Jun 2026',
    status: 'Not Started',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
      { code: 'K6', label: 'Marketing planning frameworks and campaign development', type: 'Knowledge' },
      { code: 'S7', label: 'Develop customer personas to inform marketing activity', type: 'Skill' },
      { code: 'S8', label: 'Apply segmentation data to campaign planning', type: 'Skill' },
    ],
    history: [],
    isPriority: true,
    priorityLabel: 'Monthly KSB Quiz',
    retakeAllowed: true,
    retakeUntil: '4 Jul 2026',
    pointsValue: 25,
  },
  {
    id: 'qz-07',
    title: 'Week 7 Knowledge Check: Market Research Methods',
    module: 'Marketing Principles & Customer Insight',
    moduleId: 'mod-02',
    weekRef: 'Week 7',
    quizType: 'weekly',
    description: 'Primary vs secondary research, qualitative and quantitative methods, survey design, and data collection techniques.',
    questionCount: 12,
    passMark: 80,
    timeLimit: '15 mins',
    estimatedDuration: '15 mins',
    dueDate: '4 Jul 2026',
    status: 'Not Started',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K7', label: 'Market research methods and data collection', type: 'Knowledge' },
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
    ],
    history: [],
    isPriority: false,
    retakeAllowed: true,
    retakeUntil: '11 Jul 2026',
    pointsValue: 12,
  },
  {
    id: 'qz-08',
    title: 'Week 8 Knowledge Check: Persona Development',
    module: 'Marketing Principles & Customer Insight',
    moduleId: 'mod-02',
    weekRef: 'Week 8',
    quizType: 'weekly',
    description: 'Customer persona creation, data-driven persona methodology, and applying personas to campaign decisions.',
    questionCount: 12,
    passMark: 80,
    timeLimit: '15 mins',
    estimatedDuration: '15 mins',
    dueDate: '11 Jul 2026',
    status: 'Not Started',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'S7', label: 'Develop customer personas to inform marketing activity', type: 'Skill' },
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
      { code: 'S8', label: 'Apply segmentation data to campaign planning', type: 'Skill' },
    ],
    history: [],
    isPriority: false,
    retakeAllowed: true,
    retakeUntil: '18 Jul 2026',
    pointsValue: 12,
  },
  {
    id: 'qz-09',
    title: 'Digital Channels Readiness Quiz',
    module: 'Digital Marketing Channels',
    moduleId: 'mod-04',
    weekRef: '—',
    quizType: 'weekly',
    description: 'Assessment covering SEO fundamentals, content marketing strategy, social media platforms, and digital analytics.',
    questionCount: 15,
    passMark: 80,
    timeLimit: '20 mins',
    estimatedDuration: '20 mins',
    dueDate: 'TBC',
    status: 'Locked',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K8', label: 'Digital marketing channels and their application', type: 'Knowledge' },
      { code: 'S2', label: 'Develop and execute digital marketing campaigns', type: 'Skill' },
      { code: 'S3', label: 'Analyse and optimise digital marketing performance', type: 'Skill' },
    ],
    history: [],
    unlockRequirement: 'Complete all Module 2 quizzes with 80%+',
    unlockModule: 'Marketing Principles & Customer Insight',
    expectedUnlockDate: 'February 2027',
    isPriority: false,
    retakeAllowed: true,
    pointsValue: 15,
  },
  {
    id: 'qz-10',
    title: 'Campaign Metrics Checkpoint',
    module: 'Marketing Principles & Customer Insight',
    moduleId: 'mod-02',
    weekRef: 'Week 14',
    quizType: 'monthly',
    description: 'Mid-module checkpoint assessing understanding of campaign KPIs, ROI measurement, and performance evaluation frameworks.',
    questionCount: 15,
    passMark: 75,
    timeLimit: '20 mins',
    estimatedDuration: '20 mins',
    dueDate: 'TBC',
    status: 'Locked',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K9', label: 'Marketing metrics, KPIs, and performance measurement', type: 'Knowledge' },
      { code: 'S9', label: 'Evaluate campaign performance and recommend improvements', type: 'Skill' },
    ],
    history: [],
    unlockRequirement: 'Complete Week 8 Knowledge Check first',
    unlockModule: 'Marketing Principles & Customer Insight',
    expectedUnlockDate: 'August 2026',
    isPriority: false,
    retakeAllowed: true,
    pointsValue: 15,
  },
  {
    id: 'qz-11',
    title: 'Marketing Metrics Application Quiz',
    module: 'Marketing Metrics & Evaluation',
    moduleId: 'mod-05',
    weekRef: '—',
    quizType: 'monthly',
    description: 'Applied assessment on marketing analytics dashboards, attribution modelling, and data-driven decision making.',
    questionCount: 15,
    passMark: 80,
    timeLimit: '20 mins',
    estimatedDuration: '20 mins',
    dueDate: 'TBC',
    status: 'Locked',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K9', label: 'Marketing metrics, KPIs, and performance measurement', type: 'Knowledge' },
      { code: 'S10', label: 'Use data analysis to inform marketing strategy', type: 'Skill' },
      { code: 'B3', label: 'Data-driven and evidence-based decision making', type: 'Behaviour' },
    ],
    history: [],
    unlockRequirement: 'Complete Digital Marketing Channels module',
    unlockModule: 'Digital Marketing Channels',
    expectedUnlockDate: 'April 2027',
    isPriority: false,
    retakeAllowed: true,
    pointsValue: 15,
  },
  {
    id: 'qz-12',
    title: 'Gateway Knowledge Review',
    module: 'All Modules',
    moduleId: 'mod-07',
    weekRef: '—',
    quizType: 'monthly',
    description: 'Comprehensive programme-wide knowledge assessment covering all KSBs. Required for Gateway sign-off.',
    questionCount: 40,
    passMark: 75,
    timeLimit: '45 mins',
    estimatedDuration: '45 mins',
    dueDate: 'TBC',
    status: 'Locked',
    latestScore: null,
    highestScore: null,
    attemptCount: 0,
    ksbs: [
      { code: 'K1', label: 'The marketing environment and its impact on business', type: 'Knowledge' },
      { code: 'K2', label: 'Environmental analysis — PESTLE, SWOT, and competitor analysis', type: 'Knowledge' },
      { code: 'K3', label: 'The marketing mix and its application', type: 'Knowledge' },
      { code: 'K4', label: 'The impact of external factors on marketing strategy', type: 'Knowledge' },
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
      { code: 'K6', label: 'Marketing planning frameworks and campaign development', type: 'Knowledge' },
    ],
    history: [],
    unlockRequirement: 'Complete all module quizzes with 80%+ average',
    unlockModule: 'All previous modules',
    expectedUnlockDate: 'October 2027',
    isPriority: false,
    retakeAllowed: true,
    pointsValue: 40,
  },
];

/* ═══════════════════════════════════════════════════════════════
   REVISION RECOMMENDATIONS
   ═══════════════════════════════════════════════════════════════ */
export const REVISION_RECOMMENDATIONS: RevisionRecommendation[] = [
  {
    id: 'rec-01',
    title: 'STP Model Review',
    whyRecommended: 'Your segmentation knowledge is strong but targeting strategy questions showed minor gaps. A quick STP refresh will push your score from 88% to 95%+. This is particularly important as STP underpins the next two modules.',
    relatedKsbs: [
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
      { code: 'K6', label: 'Marketing planning frameworks and campaign development', type: 'Knowledge' },
    ],
    estimatedTime: '20 mins',
    resourceType: 'Reading',
    resourceHref: '/learner/this-week',
    priority: 'High',
  },
  {
    id: 'rec-02',
    title: 'Campaign Targeting Strategies',
    whyRecommended: 'Differentiated vs concentrated targeting came up in your Week 2 quiz and will feature heavily in the upcoming Monthly KSB Quiz. Understanding when to apply each strategy is a key skill assessment area.',
    relatedKsbs: [
      { code: 'K6', label: 'Marketing planning frameworks and campaign development', type: 'Knowledge' },
      { code: 'S8', label: 'Apply segmentation data to campaign planning', type: 'Skill' },
    ],
    estimatedTime: '25 mins',
    resourceType: 'Video',
    resourceHref: '/learner/this-week',
    priority: 'High',
  },
  {
    id: 'rec-03',
    title: 'Persona Development Deep Dive',
    whyRecommended: 'Customer persona creation is assessed in the Monthly KSB Quiz. Your workplace evidence shows strong persona work but the quiz will test theoretical methodology — make sure you can explain the process, not just apply it.',
    relatedKsbs: [
      { code: 'S7', label: 'Develop customer personas to inform marketing activity', type: 'Skill' },
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
    ],
    estimatedTime: '30 mins',
    resourceType: 'Reading',
    resourceHref: '/learner/this-week',
    priority: 'Medium',
  },
  {
    id: 'rec-04',
    title: 'Marketing Metrics Fundamentals',
    whyRecommended: 'Metrics questions appeared in your Week 3 assessment and will increase in Module 3. Getting comfortable with ROI, CPA, CLV, and attribution models now will give you a significant advantage later.',
    relatedKsbs: [
      { code: 'K9', label: 'Marketing metrics, KPIs, and performance measurement', type: 'Knowledge' },
    ],
    estimatedTime: '35 mins',
    resourceType: 'Podcast',
    resourceHref: '/learner/this-week',
    priority: 'Medium',
  },
  {
    id: 'rec-05',
    title: 'Customer Insight & Research Methods',
    whyRecommended: 'Market research methods are tested in your upcoming Week 7 quiz. Your qualitative research understanding is strong but quantitative methods could use a quick refresh — especially survey design and sampling techniques.',
    relatedKsbs: [
      { code: 'K7', label: 'Market research methods and data collection', type: 'Knowledge' },
      { code: 'K5', label: 'Customer segmentation and targeting strategies', type: 'Knowledge' },
    ],
    estimatedTime: '25 mins',
    resourceType: 'Reading',
    resourceHref: '/learner/this-week',
    priority: 'Low',
  },
];

/* ═══════════════════════════════════════════════════════════════
   KNOWLEDGE BADGES
   ═══════════════════════════════════════════════════════════════ */
export const KNOWLEDGE_BADGES: KnowledgeBadge[] = [
  {
    id: 'badge-01',
    name: 'First Quiz Pass',
    description: 'Passed your first knowledge check',
    earned: true,
    earnedDate: '23 May 2026',
    icon: 'ri-award-line',
  },
  {
    id: 'badge-02',
    name: 'Perfect Score',
    description: 'Achieved 100% on any quiz',
    earned: false,
    icon: 'ri-medal-line',
  },
  {
    id: 'badge-03',
    name: 'Streak Master',
    description: 'Passed 3 quizzes in a row on first attempt',
    earned: true,
    earnedDate: '6 Jun 2026',
    icon: 'ri-flashlight-line',
  },
  {
    id: 'badge-04',
    name: 'Monthly Champion',
    description: 'Top score in a monthly KSB progress quiz',
    earned: false,
    icon: 'ri-trophy-line',
  },
  {
    id: 'badge-05',
    name: 'Knowledge Seeker',
    description: 'Completed 5 quizzes across different modules',
    earned: false,
    icon: 'ri-book-read-line',
  },
  {
    id: 'badge-06',
    name: 'Speed Learner',
    description: 'Completed a quiz in under 60% of the allotted time with a pass',
    earned: true,
    earnedDate: '23 May 2026',
    icon: 'ri-speed-up-line',
  },
];