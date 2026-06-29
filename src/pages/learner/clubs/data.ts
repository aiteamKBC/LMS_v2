export interface EventSpeaker {
  name: string;
  role: string;
  company: string;
  bio: string;
  avatar: string;
  avatarImg?: string;
  topics: string[];
}

export interface AgendaItem {
  time: string;
  title: string;
  speaker?: string;
  description: string;
  type: 'opening' | 'talk' | 'workshop' | 'break' | 'qa' | 'networking' | 'close';
}

export interface EventAttendee {
  name: string;
  avatar: string;
  role: string;
  joined: boolean;
}

export interface HostBio {
  name: string;
  avatar: string;
  avatarImg?: string;
  role: string;
  company: string;
  bio: string;
  linkedin?: string;
  expertise: string[];
  sessionsHosted: number;
  avgRating: number;
}

export interface ClubEvent {
  id: string;
  date: string;
  dayName: string;
  time: string;
  title: string;
  club: string;
  clubId: string;
  joined: boolean;
  type: string;
  format: string;
  location: string;
  host: string;
  hostRole: string;
  points: number;
  attendanceStatus: 'attending' | 'not-attending' | 'available';
  description: string;
  capacity: number;
  rsvpCount: number;
  waitlist: string[];
  hasQrCode?: boolean;
  image?: string;
  hostBio?: HostBio;
  speakers?: EventSpeaker[];
  agenda?: AgendaItem[];
  attendees?: EventAttendee[];
  tags?: string[];
  prerequisites?: string[];
  outcomes?: string[];
}

export interface CommunityActivity {
  id: string;
  title: string;
  description: string;
  club: string;
  clubId: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  estimatedTime: string;
  points: number;
  evidenceRequired: boolean;
  approvalRequired: boolean;
  icon: string;
  joined: boolean;
  category: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  club: string;
  points: number;
  contributions: number;
  badge: string;
  avatar: string;
  highlight?: boolean;
  movement: 'up' | 'down' | 'same';
  category: 'all-time' | 'monthly' | 'club';
}

export interface AmbassadorData {
  name: string;
  club: string;
  clubId: string;
  role: string;
  bio: string;
  expertise: string[];
  avatar: string;
  joined: string;
  sessionsHosted: number;
  contributions: number;
  topics: string[];
}

export interface FeedItem {
  id: string;
  type: 'achievement' | 'resource' | 'event-recap' | 'discussion' | 'announcement' | 'badge';
  user: string;
  userAvatar: string;
  userRole: string;
  club: string;
  clubId: string;
  content: string;
  date: string;
  timeAgo: string;
  likes: number;
  comments: number;
  image?: string;
  joined: boolean;
}

export interface CommunityBadge {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: 'primary' | 'accent' | 'secondary';
  earned: boolean;
  progress?: number;
  progressTarget?: number;
  progressLabel?: string;
  earnedDate?: string;
}

export interface PointRule {
  id: string;
  action: string;
  description: string;
  points: number;
  icon: string;
  color: 'primary' | 'accent' | 'secondary';
}

export interface CommunityClub {
  id: string;
  title: string;
  desc: string;
  members: number;
  nextEvent: string;
  nextEventDate: string;
  activity: string;
  activityLevel: 'Very Active' | 'Active' | 'Moderate';
  icon: string;
  badge: string | null;
  joined: boolean;
  category: string;
  foundedDate: string;
  ambassador: string;
  joinDate?: string;
  pointsEarned?: number;
  latestDiscussion?: string;
  recentActivity?: string;
  recentActivityCount?: number;
  benefits: string[];
}

// ─── CLUBS ───
export const CLUBS: CommunityClub[] = [
  {
    id: 'cl-01', title: 'Marketing Club', category: 'Professional Development',
    desc: 'For marketing apprentices to share insights, discuss campaigns, and explore the latest marketing trends. Guest speakers from leading brands including Unilever, Tesco, and the Chartered Institute of Marketing.',
    members: 28, nextEvent: 'Social Media Strategy Workshop', nextEventDate: '20 Jun',
    activity: 'Active', activityLevel: 'Active', icon: 'ri-megaphone-line', badge: 'Top Contributor',
    joined: true, foundedDate: 'January 2025', ambassador: 'Rebecca Okonkwo',
    joinDate: 'Jan 2025', pointsEarned: 320,
    latestDiscussion: 'Campaign ROI frameworks — 3 new replies',
    recentActivity: '4 New Discussions', recentActivityCount: 4,
    benefits: ['Peer Networking', 'Industry Speakers', 'Campaign Workshops', 'Portfolio Building', 'Mentorship Opportunities'],
  },
  {
    id: 'cl-02', title: 'Project Controls Club', category: 'Professional Skills',
    desc: 'Develop your project management and organisational skills. Share planning techniques, discuss real project challenges, and learn from experienced professionals across infrastructure, construction, and corporate sectors.',
    members: 15, nextEvent: 'Risk Management in Practice', nextEventDate: '27 Jun',
    activity: 'Moderate', activityLevel: 'Moderate', icon: 'ri-projector-line', badge: null,
    joined: false, foundedDate: 'March 2025', ambassador: 'James Harrington',
    benefits: ['Project Planning Tools', 'Risk Management Skills', 'Industry Case Studies', 'PMP Knowledge Sharing', 'Peer Review Sessions'],
  },
  {
    id: 'cl-03', title: 'Leadership Club', category: 'Career Growth',
    desc: 'For apprentices aspiring to leadership roles. Explore management theory, hear from senior leaders, and build your professional network through structured mentoring and peer coaching.',
    members: 22, nextEvent: 'Leading with Emotional Intelligence', nextEventDate: '15 Jun',
    activity: 'Active', activityLevel: 'Active', icon: 'ri-user-star-line', badge: null,
    joined: true, foundedDate: 'February 2025', ambassador: 'Sarah Chen',
    joinDate: 'Feb 2025', pointsEarned: 245,
    latestDiscussion: 'Situational leadership models — 7 new replies',
    recentActivity: '6 New Discussions', recentActivityCount: 6,
    benefits: ['Leadership Coaching', 'Peer Mentoring', 'Senior Leader Talks', 'Management Theory', 'Career Acceleration'],
  },
  {
    id: 'cl-04', title: 'Career Growth Club', category: 'Career Growth',
    desc: 'Focus on your career development beyond the apprenticeship. CV workshops, interview practice, personal branding, and career planning with recruiters from leading UK employers.',
    members: 34, nextEvent: 'LinkedIn Profile Masterclass', nextEventDate: '22 Jun',
    activity: 'Very Active', activityLevel: 'Very Active', icon: 'ri-briefcase-line', badge: null,
    joined: false, foundedDate: 'January 2025', ambassador: 'Priya Patel',
    benefits: ['CV Reviews', 'Mock Interviews', 'Personal Branding', 'LinkedIn Optimisation', 'Recruiter Access'],
  },
  {
    id: 'cl-05', title: 'British Values & Professional Practice', category: 'Professional Development',
    desc: 'Explore British values in a professional context. Discuss ethics, integrity, and what it means to be a professional in today\'s workplace. Regular debates on ethical dilemmas.',
    members: 18, nextEvent: 'Ethical Decision-Making Workshop', nextEventDate: '29 Jun',
    activity: 'Moderate', activityLevel: 'Moderate', icon: 'ri-flag-line', badge: null,
    joined: true, foundedDate: 'April 2025', ambassador: 'David Thompson',
    joinDate: 'Apr 2025', pointsEarned: 180,
    latestDiscussion: 'Privacy vs monitoring debate — 11 new replies',
    recentActivity: '3 New Discussions', recentActivityCount: 3,
    benefits: ['Ethics Debates', 'Professional Standards', 'Workplace Scenarios', 'Critical Thinking', 'Compliance Knowledge'],
  },
  {
    id: 'cl-06', title: 'Sustainability in Business', category: 'Special Interest',
    desc: 'Learn how businesses are responding to climate change and sustainability challenges. Share ideas for making your workplace greener and explore ESG frameworks and reporting.',
    members: 20, nextEvent: 'Green Marketing: Authenticity vs Greenwashing', nextEventDate: '18 Jun',
    activity: 'Active', activityLevel: 'Active', icon: 'ri-leaf-line', badge: null,
    joined: false, foundedDate: 'March 2025', ambassador: 'Dr. Amara Okafor',
    benefits: ['ESG Knowledge', 'Green Marketing', 'Sustainability Projects', 'Industry Panels', 'Carbon Literacy'],
  },
  {
    id: 'cl-07', title: 'AI in Marketing', category: 'Special Interest',
    desc: 'Explore how artificial intelligence is transforming marketing. Learn about AI tools, automation, and ethical considerations for modern marketers through hands-on workshops and case studies.',
    members: 25, nextEvent: 'AI Tools for Campaign Analytics', nextEventDate: '25 Jun',
    activity: 'Very Active', activityLevel: 'Very Active', icon: 'ri-robot-line', badge: 'New',
    joined: true, foundedDate: 'May 2026', ambassador: 'Tom Whitfield',
    joinDate: 'May 2026', pointsEarned: 105,
    latestDiscussion: 'ChatGPT for content ideation — 9 new replies',
    recentActivity: '8 New Discussions', recentActivityCount: 8,
    benefits: ['AI Tool Workshops', 'Automation Skills', 'Data Analytics', 'Hands-on Labs', 'Community Points'],
  },
];

export interface EventFeedback {
  id: string;
  eventId: string;
  eventTitle: string;
  clubName: string;
  eventDate: string;
  rating: number;
  comment: string;
  submittedBy: string;
  submittedDate: string;
  timeAgo: string;
}

// ─── EVENTS ───
export const EVENTS: ClubEvent[] = [
  { id: 'ev-01', date: '15 Jun', dayName: 'Sun', time: '16:00–17:00', title: 'Leading with Emotional Intelligence', club: 'Leadership Club', clubId: 'cl-03', joined: true, type: 'Workshop', format: 'Teams Live', location: 'Microsoft Teams', host: 'Sarah Chen', hostRole: 'Leadership Coach', points: 50, attendanceStatus: 'attending', description: 'Explore emotional intelligence frameworks and how to apply them in your daily leadership practice. Includes interactive group exercises and real workplace scenarios.', capacity: 20, rsvpCount: 18, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Warm%20professional%20workshop%20setting%20with%20diverse%20people%20in%20discussion%20circles%2C%20soft%20natural%20lighting%20from%20large%20windows%2C%20modern%20office%20space%20with%20wooden%20tables%20and%20green%20plants%2C%20leadership%20coaching%20session%20atmosphere%2C%20editorial%20photography%20style%20with%20warm%20neutral%20tones&width=800&height=450&seq=ev-01-img&orientation=landscape' },
  { id: 'ev-02', date: '18 Jun', dayName: 'Wed', time: '13:00–14:00', title: 'Green Marketing: Authenticity vs Greenwashing', club: 'Sustainability in Business', clubId: 'cl-06', joined: false, type: 'Panel Discussion', format: 'Teams Live', location: 'Microsoft Teams', host: 'Dr. Amara Okafor', hostRole: 'Sustainability Lead', points: 75, attendanceStatus: 'available', description: 'A panel discussion with three industry experts on how brands can communicate sustainability authentically without falling into greenwashing traps.', capacity: 30, rsvpCount: 22, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Modern%20sustainable%20business%20concept%20with%20green%20leaf%20elements%20and%20clean%20eco-friendly%20packaging%20on%20minimal%20white%20surface%2C%20soft%20natural%20lighting%2C%20sustainability%20marketing%20visual%20with%20organic%20textures%20and%20earth%20tones%2C%20editorial%20product%20photography%20style&width=800&height=450&seq=ev-02-img&orientation=landscape' },
  { id: 'ev-03', date: '20 Jun', dayName: 'Fri', time: '15:00–16:30', title: 'Social Media Strategy Workshop', club: 'Marketing Club', clubId: 'cl-01', joined: true, type: 'Workshop', format: 'Interactive Teams', location: 'Microsoft Teams', host: 'Rebecca Okonkwo', hostRole: 'CIM Member', points: 50, attendanceStatus: 'attending', description: 'Build a complete social media strategy from scratch. Bring your workplace examples — we will workshop real campaigns together with peer feedback.', capacity: 25, rsvpCount: 25, waitlist: ['Emma Lewis', 'Liam Foster'], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Creative%20social%20media%20marketing%20workspace%20with%20laptop%20showing%20colorful%20dashboard%20and%20analytics%20charts%2C%20smartphone%20with%20engagement%20metrics%2C%20coffee%20cup%20and%20notebook%20on%20clean%20modern%20desk%2C%20bright%20natural%20lighting%2C%20warm%20professional%20atmosphere%2C%20editorial%20photography&width=800&height=450&seq=ev-03-img&orientation=landscape' },
  { id: 'ev-04', date: '22 Jun', dayName: 'Sun', time: '12:00–13:00', title: 'LinkedIn Profile Masterclass', club: 'Career Growth Club', clubId: 'cl-04', joined: false, type: 'Masterclass', format: 'Teams Live', location: 'Microsoft Teams', host: 'Priya Patel', hostRole: 'Talent Acquisition Manager', points: 75, attendanceStatus: 'available', description: 'Transform your LinkedIn profile from average to outstanding. Learn what recruiters actually look for and get live feedback on your profile during the session.', capacity: 30, rsvpCount: 14, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Professional%20LinkedIn%20networking%20concept%20with%20laptop%20showing%20professional%20profile%20page%2C%20clean%20modern%20desk%20with%20minimal%20decor%2C%20business%20professional%20items%20like%20notebook%20and%20pen%2C%20soft%20natural%20lighting%20from%20window%2C%20warm%20neutral%20color%20palette%2C%20editorial%20career%20photography&width=800&height=450&seq=ev-04-img&orientation=landscape' },
  { id: 'ev-05', date: '25 Jun', dayName: 'Wed', time: '14:00–15:00', title: 'AI Tools for Campaign Analytics', club: 'AI in Marketing', clubId: 'cl-07', joined: true, type: 'Hands-on Lab', format: 'Interactive Teams', location: 'Microsoft Teams', host: 'Tom Whitfield', hostRole: 'Marketing Technologist', points: 50, attendanceStatus: 'attending', description: 'Hands-on lab exploring AI-powered analytics tools. You will build a campaign dashboard using real data and AI-assisted insights generation.', capacity: 15, rsvpCount: 15, waitlist: ['Chloe Parkinson', 'Marcus Webb', 'Olivia Park'], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Modern%20AI%20analytics%20dashboard%20on%20large%20monitor%20screen%20with%20colorful%20data%20visualizations%20charts%20and%20graphs%2C%20futuristic%20technology%20workspace%20with%20clean%20minimal%20desk%2C%20soft%20ambient%20lighting%2C%20artificial%20intelligence%20marketing%20tools%20concept%2C%20professional%20editorial%20photography%20style&width=800&height=450&seq=ev-05-img&orientation=landscape' },
  { id: 'ev-06', date: '27 Jun', dayName: 'Fri', time: '11:00–12:00', title: 'Risk Management in Practice', club: 'Project Controls Club', clubId: 'cl-02', joined: false, type: 'Case Study', format: 'Teams Live', location: 'Microsoft Teams', host: 'James Harrington', hostRole: 'PMP Certified', points: 50, attendanceStatus: 'available', description: 'Work through a real infrastructure project risk assessment. Learn practical risk identification, analysis, and mitigation planning techniques.', capacity: 20, rsvpCount: 8, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Project%20risk%20management%20concept%20with%20organized%20planning%20documents%20spreadsheets%20and%20risk%20matrix%20charts%20on%20clean%20modern%20desk%2C%20professional%20office%20setting%20with%20soft%20natural%20lighting%2C%20warm%20neutral%20tones%2C%20infrastructure%20blueprints%20and%20Gantt%20charts%20visible%2C%20editorial%20business%20photography&width=800&height=450&seq=ev-06-img&orientation=landscape' },
  { id: 'ev-07', date: '29 Jun', dayName: 'Sun', time: '15:30–17:00', title: 'Ethical Decision-Making Workshop', club: 'British Values & Professional Practice', clubId: 'cl-05', joined: true, type: 'Workshop', format: 'Teams Live', location: 'Microsoft Teams', host: 'David Thompson', hostRole: 'Ethics & Compliance', points: 50, attendanceStatus: 'attending', description: 'Interactive workshop exploring real ethical dilemmas faced in UK workplaces. Practice structured decision-making frameworks with peer discussion.', capacity: 25, rsvpCount: 11, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Ethical%20decision%20making%20concept%20with%20balanced%20scales%20and%20professional%20documents%20on%20clean%20modern%20desk%2C%20warm%20soft%20lighting%20from%20window%2C%20justice%20and%20integrity%20visual%20metaphor%20with%20minimal%20elegant%20composition%2C%20neutral%20earth%20tones%20and%20natural%20wood%20textures%2C%20editorial%20photography%20style&width=800&height=450&seq=ev-07-img&orientation=landscape' },
  { id: 'ev-08', date: '2 Jul', dayName: 'Wed', time: '13:00–14:00', title: 'Marketing Club Monthly Showcase', club: 'Marketing Club', clubId: 'cl-01', joined: true, type: 'Showcase', format: 'Teams Live', location: 'Microsoft Teams', host: 'Club Members', hostRole: 'Community', points: 50, attendanceStatus: 'attending', description: 'Monthly showcase where club members present their best campaign work. Great opportunity to see what peers are achieving and get inspired.', capacity: 30, rsvpCount: 16, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Professional%20showcase%20presentation%20event%20with%20modern%20stage%20setup%20and%20large%20screen%20displaying%20colorful%20marketing%20campaign%20slides%2C%20audience%20seated%20in%20bright%20modern%20conference%20room%2C%20warm%20natural%20lighting%2C%20professional%20networking%20atmosphere%2C%20editorial%20event%20photography%20style&width=800&height=450&seq=ev-08-img&orientation=landscape' },
  { id: 'ev-09', date: '5 Jul', dayName: 'Sat', time: '10:00–11:30', title: 'Networking Brunch: Meet Your Cohort', club: 'Career Growth Club', clubId: 'cl-04', joined: false, type: 'Networking Event', format: 'In-Person — London', location: 'KBC London Campus', host: 'Priya Patel', hostRole: 'Career Ambassador', points: 100, attendanceStatus: 'available', description: 'In-person networking brunch for apprentices across all programmes. Meet peers face-to-face, exchange experiences, and build lasting professional connections.', capacity: 40, rsvpCount: 32, waitlist: [], hasQrCode: true, image: 'https://readdy.ai/api/search-image?query=Professional%20networking%20brunch%20event%20with%20diverse%20professionals%20gathered%20around%20elegant%20breakfast%20table%20with%20fresh%20coffee%20and%20pastries%2C%20bright%20modern%20event%20space%20with%20large%20windows%20and%20natural%20light%2C%20warm%20friendly%20conversation%20atmosphere%2C%20editorial%20event%20photography%20style&width=800&height=450&seq=ev-09-img&orientation=landscape' },
  { id: 'ev-10', date: '8 Jul', dayName: 'Tue', time: '17:00–18:00', title: 'AI Ethics: Marketing in the Age of Algorithms', club: 'AI in Marketing', clubId: 'cl-07', joined: true, type: 'Panel Discussion', format: 'Teams Live', location: 'Microsoft Teams', host: 'Tom Whitfield', hostRole: 'Marketing Technologist', points: 75, attendanceStatus: 'available', description: 'Expert panel discussing the ethical implications of AI in marketing — bias, transparency, data privacy, and responsible automation.', capacity: 50, rsvpCount: 28, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Digital%20ethics%20and%20AI%20technology%20concept%20with%20abstract%20glowing%20neural%20network%20visualization%20and%20human%20silhouette%20on%20modern%20screen%2C%20clean%20minimal%20dark%20background%20with%20soft%20accent%20lighting%2C%20technology%20responsibility%20visual%20metaphor%2C%20professional%20editorial%20photography%20style&width=800&height=450&seq=ev-10-img&orientation=landscape' },
  { id: 'ev-11', date: '10 Jul', dayName: 'Thu', time: '14:00–15:30', title: 'Project Simulation Workshop', club: 'Project Controls Club', clubId: 'cl-02', joined: false, type: 'Workshop', format: 'Interactive Teams', location: 'Microsoft Teams', host: 'James Harrington', hostRole: 'PMP Certified', points: 50, attendanceStatus: 'available', description: 'Participate in a simulated project from initiation to close. Apply project management methodologies in a risk-free environment with real-time feedback.', capacity: 12, rsvpCount: 7, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Professional%20project%20simulation%20workshop%20with%20team%20collaborating%20around%20whiteboard%20with%20colorful%20sticky%20notes%20and%20project%20timelines%2C%20modern%20office%20space%20with%20natural%20lighting%2C%20collaborative%20teamwork%20atmosphere%2C%20warm%20neutral%20tones%20with%20colorful%20accent%20elements%2C%20editorial%20business%20photography&width=800&height=450&seq=ev-11-img&orientation=landscape' },
  { id: 'ev-12', date: '12 Jul', dayName: 'Sat', time: '11:00–12:00', title: 'Revision Session: Marketing Principles', club: 'Marketing Club', clubId: 'cl-01', joined: true, type: 'Study Group', format: 'Teams Live', location: 'Microsoft Teams', host: 'Rebecca Okonkwo', hostRole: 'Club Ambassador', points: 50, attendanceStatus: 'available', description: 'Group revision session covering key marketing principles for upcoming assessments. Peer-led with ambassador facilitation and practice questions.', capacity: 18, rsvpCount: 9, waitlist: [], hasQrCode: false, image: 'https://readdy.ai/api/search-image?query=Study%20group%20revision%20session%20with%20open%20marketing%20textbooks%20and%20laptops%20on%20clean%20modern%20study%20table%2C%20colorful%20highlighters%20and%20notes%20spread%20around%2C%20bright%20natural%20lighting%20from%20window%2C%20warm%20academic%20atmosphere%20with%20coffee%20cup%2C%20editorial%20education%20photography%20style&width=800&height=450&seq=ev-12-img&orientation=landscape' },
];

// ─── EVENT DETAIL DATA ───
export const EVENT_DETAIL_DATA: Record<string, {
  hostBio: HostBio;
  speakers: EventSpeaker[];
  agenda: AgendaItem[];
  attendees: EventAttendee[];
  tags: string[];
  prerequisites: string[];
  outcomes: string[];
}> = {
  'ev-01': {
    tags: ['Emotional Intelligence', 'Leadership', 'Self-Awareness', 'Team Management'],
    prerequisites: ['None — open to all levels'],
    outcomes: [
      'Understand the 5 components of emotional intelligence',
      'Apply the pause-and-name technique in live scenarios',
      'Build a personal EI development action plan',
    ],
    hostBio: {
      name: 'Sarah Chen',
      avatar: 'SC',
      avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20Asian%20woman%20leadership%20coach%20in%20smart%20business%20attire%2C%20warm%20confident%20smile%2C%20clean%20minimal%20white%20background%2C%20editorial%20portrait%20photography%2C%20natural%20soft%20warm%20lighting%2C%20high%20detail%20face%20visible&width=200&height=200&seq=host-sarah-chen-01&orientation=squarish',
      role: 'Leadership Club Ambassador',
      company: 'Tesco / KBC Academy',
      bio: 'Sarah is a Level 5 Operations Manager apprentice at Tesco who built the Leadership Club from scratch. She has mentored over 40 apprentices and her Emotional Intelligence workshop consistently scores 4.9/5. She holds a Certificate in Coaching and is trained in the Goleman EI framework and Hersey-Blanchard Situational Leadership model.',
      linkedin: 'linkedin.com/in/sarahchen-leadership',
      expertise: ['Emotional Intelligence', 'Coaching', 'Situational Leadership', 'Team Dynamics'],
      sessionsHosted: 10,
      avgRating: 4.9,
    },
    speakers: [
      {
        name: 'Sarah Chen',
        role: 'Leadership Coach & Ambassador',
        company: 'KBC Academy',
        bio: 'Sarah brings lived leadership experience from her role managing teams at Tesco while studying. She designed this workshop curriculum based on research from Harvard Business Review and Daniel Goleman original EI studies.',
        avatar: 'SC',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20Asian%20woman%20speaker%20presenting%20in%20modern%20boardroom%2C%20confident%20warm%20expression%2C%20clean%20neutral%20grey%20background%2C%20editorial%20professional%20portrait%2C%20natural%20side%20lighting%2C%20sharp%20focus&width=200&height=200&seq=sp-sarah-chen-02&orientation=squarish',
        topics: ['Self-Awareness', 'Empathy', 'Social Skills', 'Emotional Regulation'],
      },
      {
        name: 'Chloe Parkinson',
        role: 'Peer Facilitator',
        company: 'KBC Learner Community',
        bio: 'Chloe facilitated the breakout group sessions following the workshop and shared her personal journey applying EI principles in her apprenticeship at a major retail firm.',
        avatar: 'CP',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20young%20British%20woman%20in%20smart%20casual%20business%20attire%2C%20friendly%20warm%20smile%2C%20clean%20bright%20cream%20background%2C%20professional%20portrait%20photography%2C%20soft%20diffused%20natural%20light%2C%20detailed%20face&width=200&height=200&seq=sp-chloe-parkinson-03&orientation=squarish',
        topics: ['Peer Learning', 'Real-World Application', 'Group Facilitation'],
      },
    ],
    agenda: [
      { time: '16:00', title: 'Welcome & Context Setting', speaker: 'Sarah Chen', description: 'Introduction to the session objectives and the science behind emotional intelligence. Why EI matters more than IQ in leadership.', type: 'opening' },
      { time: '16:10', title: 'The 5 Components of EI', speaker: 'Sarah Chen', description: 'Deep dive into the Goleman EI framework: self-awareness, self-regulation, motivation, empathy, and social skills. Live Q&A throughout.', type: 'talk' },
      { time: '16:30', title: 'Pause-and-Name Technique Demo', speaker: 'Sarah Chen', description: 'Live demonstration of the pause-and-name technique with real workplace scenarios. Participants practice in pairs.', type: 'workshop' },
      { time: '16:45', title: 'Group Breakout: Applying EI at Work', speaker: 'Chloe Parkinson', description: 'Small groups discuss real challenges they face and apply EI principles to find better responses. Facilitated by Chloe.', type: 'workshop' },
      { time: '16:55', title: 'Q&A and Action Planning', speaker: 'Sarah Chen', description: 'Open Q&A followed by personal EI development plan. Each participant commits to one EI practice before the next session.', type: 'qa' },
    ],
    attendees: [
      { name: 'Sophie Williams', avatar: 'SW', role: 'Marketing Apprentice', joined: true },
      { name: 'Chloe Parkinson', avatar: 'CP', role: 'Leadership Apprentice', joined: true },
      { name: 'Marcus Webb', avatar: 'MW', role: 'Marketing Apprentice', joined: true },
      { name: 'Zara Mahmood', avatar: 'ZM', role: 'Career Growth Apprentice', joined: true },
      { name: 'Alex Kimani', avatar: 'AK', role: 'Marketing Apprentice', joined: true },
      { name: 'Ryan OConnor', avatar: 'RC', role: 'Sustainability Apprentice', joined: false },
      { name: 'Emma Lewis', avatar: 'EL', role: 'AI Marketing Apprentice', joined: false },
      { name: 'Daniel Park', avatar: 'DP', role: 'Project Controls Apprentice', joined: false },
    ],
  },
  'ev-02': {
    tags: ['Greenwashing', 'Sustainability', 'Brand Ethics', 'ESG', 'Marketing'],
    prerequisites: ['Basic understanding of marketing communications'],
    outcomes: [
      'Identify common greenwashing tactics used by major brands',
      'Apply authenticity frameworks to sustainability claims',
      'Understand ASA regulations around environmental claims',
    ],
    hostBio: {
      name: 'Dr. Amara Okafor',
      avatar: 'AO',
      avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20Black%20woman%20environmental%20scientist%20academic%20in%20elegant%20smart%20professional%20attire%2C%20confident%20intelligent%20expression%2C%20clean%20minimal%20white%20studio%20background%2C%20editorial%20professional%20portrait%2C%20warm%20natural%20window%20lighting%2C%20high%20detail&width=200&height=200&seq=host-amara-okafor-04&orientation=squarish',
      role: 'Sustainability Lead & Club Ambassador',
      company: 'KBC Academy',
      bio: 'Dr. Amara Okafor holds a doctorate in Environmental Management and is completing her Level 6 degree apprenticeship. She has connected KBC to two industry ESG panels and her greenwashing detection sessions are among the most requested across all clubs.',
      expertise: ['ESG Reporting', 'Carbon Footprinting', 'Green Marketing', 'Corporate Sustainability'],
      sessionsHosted: 9,
      avgRating: 4.8,
    },
    speakers: [
      {
        name: 'Dr. Amara Okafor',
        role: 'Environmental Management PhD',
        company: 'KBC Academy',
        bio: 'With a background in environmental science and corporate sustainability consulting, Dr. Okafor provides cutting-edge perspectives on how brands can communicate sustainably without misleading consumers.',
        avatar: 'AO',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20Black%20woman%20sustainability%20expert%20speaker%20in%20smart%20green%20professional%20attire%2C%20academic%20confident%20expression%2C%20clean%20light%20studio%20background%2C%20editorial%20portrait%20photography%2C%20soft%20diffused%20lighting%2C%20sharp%20focus&width=200&height=200&seq=sp-amara-okafor-05&orientation=squarish',
        topics: ['ESG', 'Green Claims', 'Carbon Reporting', 'Environmental Science'],
      },
      {
        name: 'Ryan O\'Connor',
        role: 'Sustainability Apprentice',
        company: 'KBC Learner Community',
        bio: 'Ryan brings a consumer watchdog perspective, having catalogued over 30 greenwashing examples from major UK brands as part of his apprenticeship project.',
        avatar: 'RC',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20young%20British%20man%20in%20smart%20casual%20eco%20friendly%20clothing%2C%20natural%20friendly%20expression%2C%20clean%20bright%20minimal%20background%2C%20modern%20professional%20portrait%2C%20natural%20window%20light%2C%20detailed%20face%20photography&width=200&height=200&seq=sp-ryan-oconnor-06&orientation=squarish',
        topics: ['Consumer Behaviour', 'Brand Audit', 'Greenwashing Detection'],
      },
    ],
    agenda: [
      { time: '13:00', title: 'Welcome & Panel Introduction', speaker: 'Dr. Amara Okafor', description: 'Overview of the session, panellist introductions, and scene-setting: why greenwashing is a growing crisis.', type: 'opening' },
      { time: '13:10', title: 'The Greenwashing Spectrum', speaker: 'Dr. Amara Okafor', description: 'From subtle misleading to outright fraud — exploring the spectrum of sustainability misrepresentation with live brand case studies.', type: 'talk' },
      { time: '13:25', title: 'Consumer Watchdog Perspective', speaker: "Ryan O'Connor", description: 'Real-world greenwashing examples spotted by apprentices during their placements. What are UK consumers actually noticing?', type: 'talk' },
      { time: '13:40', title: 'Panel Q&A: Live Audience Questions', speaker: 'Dr. Amara Okafor', description: 'Open Q&A with both panellists. Submit questions via chat — most upvoted questions answered first.', type: 'qa' },
      { time: '13:55', title: 'Takeaways & Resource Drop', speaker: 'Dr. Amara Okafor', description: 'Final takeaways and link to the Greenwashing Spotting Guide uploaded to the resources library.', type: 'close' },
    ],
    attendees: [
      { name: "Ryan O'Connor", avatar: 'RC', role: 'Sustainability Apprentice', joined: true },
      { name: 'Fatima Hassan', avatar: 'FH', role: 'Marketing Apprentice', joined: true },
      { name: 'Olivia Park', avatar: 'OP', role: 'Marketing Apprentice', joined: true },
      { name: 'Alex Kimani', avatar: 'AK', role: 'Marketing Apprentice', joined: false },
      { name: 'Sophie Williams', avatar: 'SW', role: 'Marketing Apprentice', joined: false },
    ],
  },
  'ev-03': {
    tags: ['Social Media', 'Strategy', 'Campaigns', 'Brand Voice', 'Analytics'],
    prerequisites: ['Basic social media account management experience recommended'],
    outcomes: [
      'Build a complete social media strategy from scratch',
      'Apply the RACE framework to social channel selection',
      'Create a 30-day content calendar with measurable KPIs',
    ],
    hostBio: {
      name: 'Rebecca Okonkwo',
      avatar: 'RO',
      avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20Black%20woman%20marketing%20executive%20in%20smart%20corporate%20business%20attire%2C%20confident%20warm%20professional%20smile%2C%20clean%20minimal%20studio%20background%2C%20editorial%20professional%20portrait%2C%20natural%20warm%20soft%20lighting%2C%20high%20quality%20face%20detail&width=200&height=200&seq=host-rebecca-okonkwo-07&orientation=squarish',
      role: 'Marketing Club Ambassador',
      company: 'Unilever / KBC Academy',
      bio: 'Rebecca is a Level 4 Marketing Executive at Unilever and KBC Marketing Club Ambassador. She has run 12 sessions and has reviewed over 200 apprentice campaigns. Her social media workshops consistently sell out within 48 hours of posting.',
      linkedin: 'linkedin.com/in/rebeccaokonkwo',
      expertise: ['Brand Strategy', 'Social Media', 'Campaign Analytics', 'STP Framework'],
      sessionsHosted: 12,
      avgRating: 4.9,
    },
    speakers: [
      {
        name: 'Rebecca Okonkwo',
        role: 'Level 4 Marketing Executive',
        company: 'Unilever',
        bio: 'Rebecca brings real Unilever campaign data to her workshops. Her social media strategy template has been downloaded 300+ times and her session format — build a live strategy in 90 minutes — is unique to KBC.',
        avatar: 'RO',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20Black%20woman%20marketing%20speaker%20presenting%20at%20modern%20business%20conference%2C%20energetic%20confident%20expression%2C%20clean%20presentation%20stage%20background%2C%20editorial%20event%20photography%2C%20professional%20warm%20ambient%20lighting&width=200&height=200&seq=sp-rebecca-ok-08&orientation=squarish',
        topics: ['Social Strategy', 'Content Planning', 'Brand Voice', 'KPIs'],
      },
      {
        name: 'Olivia Park',
        role: 'Marketing Apprentice & Peer Reviewer',
        company: 'KBC Learner Community',
        bio: 'Olivia viral Instagram campaign (50K impressions, £200 budget) became the case study for this workshop. She co-facilitates the peer review segment.',
        avatar: 'OP',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20young%20East%20Asian%20woman%20in%20creative%20modern%20marketing%20workspace%2C%20confident%20casual%20smile%2C%20bright%20modern%20office%20background%20with%20plants%2C%20editorial%20portrait%20photography%2C%20natural%20window%20light%2C%20sharp%20focus&width=200&height=200&seq=sp-olivia-park-09&orientation=squarish',
        topics: ['Organic Growth', 'Instagram', 'Low-Budget Campaigns', 'Peer Review'],
      },
    ],
    agenda: [
      { time: '15:00', title: 'Session Opening', speaker: 'Rebecca Okonkwo', description: 'Welcome, objectives overview, and quick poll: which social channels are attendees currently managing?', type: 'opening' },
      { time: '15:10', title: 'The RACE Framework for Social Media', speaker: 'Rebecca Okonkwo', description: 'How to use Reach, Act, Convert, Engage to structure your social strategy. Live example from Unilever campaign.', type: 'talk' },
      { time: '15:30', title: 'Live Case Study: 50K Impressions for £200', speaker: 'Olivia Park', description: 'Olivia walks through her viral campaign step-by-step — creative choices, posting schedule, and what surprised her most.', type: 'talk' },
      { time: '15:45', title: 'Workshop: Build Your Strategy', speaker: 'Rebecca Okonkwo', description: 'Using the STP + RACE template, participants draft their own social media strategy using a current workplace campaign.', type: 'workshop' },
      { time: '16:20', title: 'Peer Review Showcase', speaker: 'Olivia Park', description: 'Volunteers share their draft strategies for live feedback. Rebecca and Olivia provide specific, actionable suggestions.', type: 'workshop' },
      { time: '16:25', title: 'Resources & Wrap-Up', speaker: 'Rebecca Okonkwo', description: 'Template download, next steps, and preview of July showcase — submit your campaign for consideration!', type: 'close' },
    ],
    attendees: [
      { name: 'Sophie Williams', avatar: 'SW', role: 'Marketing Apprentice', joined: true },
      { name: 'Marcus Webb', avatar: 'MW', role: 'Marketing Apprentice', joined: true },
      { name: 'Olivia Park', avatar: 'OP', role: 'Marketing Apprentice', joined: true },
      { name: 'Liam Foster', avatar: 'LF', role: 'Marketing Apprentice', joined: true },
      { name: 'Fatima Hassan', avatar: 'FH', role: 'Marketing Apprentice', joined: true },
      { name: 'Emma Lewis', avatar: 'EL', role: 'AI Marketing Apprentice', joined: true },
      { name: 'Alex Kimani', avatar: 'AK', role: 'Marketing Apprentice', joined: true },
      { name: 'Zara Mahmood', avatar: 'ZM', role: 'Career Growth Apprentice', joined: false },
      { name: 'Daniel Park', avatar: 'DP', role: 'Project Controls Apprentice', joined: false },
    ],
  },
  'ev-05': {
    tags: ['AI Analytics', 'Dashboard', 'Campaign Data', 'MarTech', 'Automation'],
    prerequisites: ['Basic Excel/Sheets familiarity', 'Access to a Google Analytics or similar account helpful'],
    outcomes: [
      'Build a live AI-powered campaign analytics dashboard',
      'Apply prompt engineering to generate data insights',
      'Automate monthly reporting using AI tools',
    ],
    hostBio: {
      name: 'Tom Whitfield',
      avatar: 'TW',
      avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20young%20British%20man%20technology%20marketer%20in%20smart%20casual%20modern%20attire%2C%20innovative%20confident%20expression%2C%20modern%20tech%20startup%20office%20background%20with%20screens%2C%20editorial%20portrait%20photography%2C%20cool%20natural%20ambient%20lighting%2C%20sharp%20focus&width=200&height=200&seq=host-tom-whitfield-10&orientation=squarish',
      role: 'AI in Marketing Club Ambassador',
      company: 'MarTech Agency / KBC Academy',
      bio: 'Tom is KBC youngest club ambassador and built the AI in Marketing club from zero to 25 members in 6 months. His hands-on labs are the highest-rated sessions across all clubs. He works at a London MarTech agency managing AI-powered campaign automation for FTSE 250 clients.',
      linkedin: 'linkedin.com/in/tomwhitfield-martech',
      expertise: ['AI Tools', 'Marketing Automation', 'Data Analytics', 'Prompt Engineering'],
      sessionsHosted: 6,
      avgRating: 5.0,
    },
    speakers: [
      {
        name: 'Tom Whitfield',
        role: 'Marketing Technologist',
        company: 'London MarTech Agency',
        bio: 'Tom has built AI analytics systems for clients including several FTSE 250 brands. His prompt engineering workbook has been downloaded 42 times and is cited as a career-changing resource by multiple learners.',
        avatar: 'TW',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20young%20British%20tech%20entrepreneur%20in%20modern%20startup%20setting%2C%20smart%20casual%20dark%20attire%2C%20confident%20innovative%20expression%2C%20clean%20tech%20office%20background%20with%20monitors%2C%20editorial%20portrait%2C%20cool%20blue%20ambient%20lighting&width=200&height=200&seq=sp-tom-whitfield-11&orientation=squarish',
        topics: ['Prompt Engineering', 'AI Analytics', 'Campaign Dashboards', 'Automation'],
      },
      {
        name: 'Emma Lewis',
        role: 'AI Marketing Apprentice & Co-Facilitator',
        company: 'KBC Learner Community',
        bio: 'Emma joined the AI club on day one and her dashboard project — built entirely using tools from Tom lab sessions — won her employer internal innovation award. She co-facilitates the hands-on exercises.',
        avatar: 'EL',
        avatarImg: 'https://readdy.ai/api/search-image?query=Professional%20young%20woman%20data%20analyst%20in%20modern%20tech%20workspace%20with%20dual%20monitors%2C%20smart%20casual%20professional%20attire%2C%20engaged%20focused%20expression%2C%20clean%20bright%20office%20background%2C%20editorial%20portrait%2C%20natural%20light&width=200&height=200&seq=sp-emma-lewis-12&orientation=squarish',
        topics: ['Data Visualisation', 'AI Tools', 'Campaign Reporting', 'Innovation'],
      },
    ],
    agenda: [
      { time: '14:00', title: 'Lab Setup & Tool Access', speaker: 'Tom Whitfield', description: 'Get everyone set up with the required tools. Tom shares the lab workbook and explains the session structure.', type: 'opening' },
      { time: '14:08', title: 'Why AI Analytics Changes Everything', speaker: 'Tom Whitfield', description: 'A fast, data-packed overview of how AI is transforming campaign measurement — speed, accuracy, and insight generation.', type: 'talk' },
      { time: '14:18', title: 'Live Build: Campaign Dashboard', speaker: 'Tom Whitfield', description: 'Tom builds a complete campaign analytics dashboard live, narrating every step. Attendees replicate in real-time using sample data.', type: 'workshop' },
      { time: '14:35', title: 'Prompt Engineering for Insights', speaker: 'Tom Whitfield', description: 'Using AI to auto-generate written insights from raw data. Tom demos 5 prompts that replace 2 hours of manual analysis.', type: 'workshop' },
      { time: '14:48', title: 'Peer Exercise: Your Own Dashboard', speaker: 'Emma Lewis', description: 'Emma guides attendees in applying what they have learned to their own campaign data. Live troubleshooting and peer help.', type: 'workshop' },
      { time: '14:56', title: 'Showcase & Next Steps', speaker: 'Tom Whitfield', description: 'Volunteers share dashboards. Resources posted to club library. Preview of July AI Ethics panel.', type: 'close' },
    ],
    attendees: [
      { name: 'Sophie Williams', avatar: 'SW', role: 'Marketing Apprentice', joined: true },
      { name: 'Emma Lewis', avatar: 'EL', role: 'AI Marketing Apprentice', joined: true },
      { name: 'Marcus Webb', avatar: 'MW', role: 'Marketing Apprentice', joined: true },
      { name: 'Liam Foster', avatar: 'LF', role: 'Marketing Apprentice', joined: true },
      { name: 'Chloe Parkinson', avatar: 'CP', role: 'Leadership Apprentice', joined: true },
      { name: 'Alex Kimani', avatar: 'AK', role: 'Marketing Apprentice', joined: true },
      { name: 'Daniel Park', avatar: 'DP', role: 'Project Controls Apprentice', joined: false },
      { name: 'Fatima Hassan', avatar: 'FH', role: 'Marketing Apprentice', joined: false },
    ],
  },
};

export function getEventDetailData(eventId: string) {
  return EVENT_DETAIL_DATA[eventId] || null;
}

// ─── ACTIVITIES ───
export const COMMUNITY_ACTIVITIES: CommunityActivity[] = [
  { id: 'act-01', title: 'Welcome New Learner', description: 'Reach out to a new club member, introduce yourself, and help them feel welcome in the community. Share your experience and offer guidance on getting started.', club: 'All Clubs', clubId: '', difficulty: 'Easy', estimatedTime: '15 mins', points: 25, evidenceRequired: false, approvalRequired: false, icon: 'ri-hand-heart-line', joined: true, category: 'Community Support' },
  { id: 'act-02', title: 'Peer Revision Session', description: 'Organise or participate in a peer-led revision session. Prepare study materials, facilitate discussion, and help fellow learners prepare for upcoming assessments.', club: 'All Clubs', clubId: '', difficulty: 'Hard', estimatedTime: '1 hour', points: 100, evidenceRequired: true, approvalRequired: true, icon: 'ri-book-open-line', joined: true, category: 'Peer Learning' },
  { id: 'act-03', title: 'LinkedIn Learning Post', description: 'Share a professional insight or lesson learned from your apprenticeship on LinkedIn. Tag KBC Academy and your club for visibility.', club: 'Marketing Club', clubId: 'cl-01', difficulty: 'Easy', estimatedTime: '20 mins', points: 75, evidenceRequired: true, approvalRequired: false, icon: 'ri-linkedin-box-line', joined: true, category: 'Professional Branding' },
  { id: 'act-04', title: 'Reflection Submission', description: 'Write a 300-word reflection on a recent workplace experience and how it connects to your apprenticeship learning. Share in your club discussion board.', club: 'All Clubs', clubId: '', difficulty: 'Medium', estimatedTime: '10 mins', points: 30, evidenceRequired: true, approvalRequired: false, icon: 'ri-edit-line', joined: true, category: 'Reflection' },
  { id: 'act-05', title: 'Share a Workplace Resource', description: 'Upload a useful template, guide, or tool that has helped you at work. Resources can include checklists, frameworks, or process documents (anonymised if needed).', club: 'All Clubs', clubId: '', difficulty: 'Easy', estimatedTime: '10 mins', points: 40, evidenceRequired: true, approvalRequired: false, icon: 'ri-folder-upload-line', joined: true, category: 'Knowledge Sharing' },
  { id: 'act-06', title: 'Lead a Club Discussion', description: 'Start and facilitate a meaningful discussion thread in your club. Choose a relevant topic, prepare discussion prompts, and engage with responses throughout the week.', club: 'All Clubs', clubId: '', difficulty: 'Medium', estimatedTime: '30 mins', points: 60, evidenceRequired: false, approvalRequired: false, icon: 'ri-discuss-line', joined: true, category: 'Leadership' },
  { id: 'act-07', title: 'Mentor a Fellow Learner', description: 'Provide one-to-one support to a peer who needs help with a specific topic or skill. Schedule a 30-minute call and share your knowledge and experience.', club: 'All Clubs', clubId: '', difficulty: 'Medium', estimatedTime: '45 mins', points: 80, evidenceRequired: true, approvalRequired: true, icon: 'ri-user-heart-line', joined: true, category: 'Mentorship' },
  { id: 'act-08', title: 'Event Recap Write-Up', description: 'Attend a club event and write a summary for members who could not make it. Include key takeaways, resources shared, and action points.', club: 'All Clubs', clubId: '', difficulty: 'Easy', estimatedTime: '20 mins', points: 35, evidenceRequired: true, approvalRequired: false, icon: 'ri-file-text-line', joined: true, category: 'Content Creation' },
  { id: 'act-09', title: 'Create a Club Poll', description: 'Design and launch a poll in your club to gather opinions on a relevant topic. Share results and facilitate discussion around the findings.', club: 'All Clubs', clubId: '', difficulty: 'Easy', estimatedTime: '15 mins', points: 25, evidenceRequired: false, approvalRequired: false, icon: 'ri-bar-chart-line', joined: true, category: 'Engagement' },
  { id: 'act-10', title: 'Present at Club Showcase', description: 'Prepare and deliver a 10-minute presentation at your club\'s monthly showcase. Share a project, campaign, or learning experience with the community.', club: 'Marketing Club', clubId: 'cl-01', difficulty: 'Hard', estimatedTime: '2 hours', points: 150, evidenceRequired: true, approvalRequired: true, icon: 'ri-presentation-line', joined: true, category: 'Public Speaking' },
  { id: 'act-11', title: 'Write a Club Blog Post', description: 'Write a 500-word blog post for the club knowledge base on a topic relevant to your apprenticeship area. Posts are published on the KBC community platform.', club: 'All Clubs', clubId: '', difficulty: 'Medium', estimatedTime: '45 mins', points: 70, evidenceRequired: true, approvalRequired: true, icon: 'ri-article-line', joined: true, category: 'Content Creation' },
  { id: 'act-12', title: 'Attend 3 Events in a Month', description: 'Attend at least three club events within a calendar month. Bonus points awarded on top of individual event points.', club: 'All Clubs', clubId: '', difficulty: 'Medium', estimatedTime: '3+ hours', points: 100, evidenceRequired: false, approvalRequired: true, icon: 'ri-calendar-check-line', joined: true, category: 'Participation' },
];

// ─── LEADERBOARD ───
export const LEADERBOARD_ALL_TIME: LeaderboardEntry[] = [
  { rank: 1, name: 'Rebecca Okonkwo', club: 'Marketing Club', points: 1250, contributions: 34, badge: 'Club Champion', avatar: 'RO', movement: 'same', category: 'all-time' },
  { rank: 2, name: 'Tom Whitfield', club: 'AI in Marketing', points: 1180, contributions: 29, badge: 'Innovation Leader', avatar: 'TW', movement: 'up', category: 'all-time' },
  { rank: 3, name: 'Priya Patel', club: 'Career Growth Club', points: 1100, contributions: 27, badge: 'Community Builder', avatar: 'PP', movement: 'same', category: 'all-time' },
  { rank: 4, name: 'Sophie Williams', club: 'Marketing Club', points: 850, contributions: 22, badge: 'Rising Star', avatar: 'SW', highlight: true, movement: 'up', category: 'all-time' },
  { rank: 5, name: 'James Harrington', club: 'Project Controls Club', points: 820, contributions: 19, badge: 'Knowledge Sharer', avatar: 'JH', movement: 'down', category: 'all-time' },
  { rank: 6, name: 'Sarah Chen', club: 'Leadership Club', points: 790, contributions: 21, badge: 'Mentor', avatar: 'SC', movement: 'same', category: 'all-time' },
  { rank: 7, name: 'David Thompson', club: 'British Values Club', points: 740, contributions: 18, badge: 'Debate Champion', avatar: 'DT', movement: 'up', category: 'all-time' },
  { rank: 8, name: 'Dr. Amara Okafor', club: 'Sustainability Club', points: 710, contributions: 16, badge: 'Green Advocate', avatar: 'AO', movement: 'same', category: 'all-time' },
  { rank: 9, name: 'Marcus Webb', club: 'Marketing Club', points: 680, contributions: 15, badge: 'Active Member', avatar: 'MW', movement: 'up', category: 'all-time' },
  { rank: 10, name: 'Chloe Parkinson', club: 'Leadership Club', points: 640, contributions: 14, badge: 'Emerging Leader', avatar: 'CP', movement: 'down', category: 'all-time' },
];

export const LEADERBOARD_MONTHLY: LeaderboardEntry[] = [
  { rank: 1, name: 'Tom Whitfield', club: 'AI in Marketing', points: 420, contributions: 14, badge: 'Monthly MVP', avatar: 'TW', movement: 'up', category: 'monthly' },
  { rank: 2, name: 'Sophie Williams', club: 'Marketing Club', points: 380, contributions: 12, badge: 'Rising Star', avatar: 'SW', highlight: true, movement: 'up', category: 'monthly' },
  { rank: 3, name: 'Rebecca Okonkwo', club: 'Marketing Club', points: 350, contributions: 10, badge: 'Consistent Performer', avatar: 'RO', movement: 'same', category: 'monthly' },
  { rank: 4, name: 'Priya Patel', club: 'Career Growth Club', points: 310, contributions: 9, badge: 'Engagement Leader', avatar: 'PP', movement: 'down', category: 'monthly' },
  { rank: 5, name: 'Marcus Webb', club: 'Marketing Club', points: 280, contributions: 8, badge: 'Active Member', avatar: 'MW', movement: 'up', category: 'monthly' },
  { rank: 6, name: 'Sarah Chen', club: 'Leadership Club', points: 260, contributions: 7, badge: 'Mentor', avatar: 'SC', movement: 'same', category: 'monthly' },
  { rank: 7, name: 'David Thompson', club: 'British Values Club', points: 240, contributions: 6, badge: 'Debate Champion', avatar: 'DT', movement: 'up', category: 'monthly' },
  { rank: 8, name: 'James Harrington', club: 'Project Controls Club', points: 220, contributions: 6, badge: 'Knowledge Sharer', avatar: 'JH', movement: 'down', category: 'monthly' },
  { rank: 9, name: 'Dr. Amara Okafor', club: 'Sustainability Club', points: 200, contributions: 5, badge: 'Green Advocate', avatar: 'AO', movement: 'same', category: 'monthly' },
  { rank: 10, name: 'Chloe Parkinson', club: 'Leadership Club', points: 180, contributions: 5, badge: 'Emerging Leader', avatar: 'CP', movement: 'new', category: 'monthly' },
];

export const LEADERBOARD_CLUB: LeaderboardEntry[] = [
  { rank: 1, name: 'Rebecca Okonkwo', club: 'Marketing Club', points: 520, contributions: 16, badge: 'Top Club Contributor', avatar: 'RO', movement: 'same', category: 'club' },
  { rank: 2, name: 'Sophie Williams', club: 'Marketing Club', points: 420, contributions: 14, badge: 'Rising Star', avatar: 'SW', highlight: true, movement: 'up', category: 'club' },
  { rank: 3, name: 'Marcus Webb', club: 'Marketing Club', points: 310, contributions: 10, badge: 'Community Contributor', avatar: 'MW', movement: 'up', category: 'club' },
  { rank: 4, name: 'Olivia Park', club: 'Marketing Club', points: 280, contributions: 9, badge: 'Active Member', avatar: 'OP', movement: 'down', category: 'club' },
  { rank: 5, name: 'Liam Foster', club: 'Marketing Club', points: 250, contributions: 8, badge: 'Emerging Contributor', avatar: 'LF', movement: 'same', category: 'club' },
];

// ─── AMBASSADORS ───
export const AMBASSADORS: AmbassadorData[] = [
  { name: 'Rebecca Okonkwo', club: 'Marketing Club', clubId: 'cl-01', role: 'Marketing Ambassador', bio: 'Level 4 Marketing Executive at Unilever. Rebecca brings real-world campaign experience and has been instrumental in growing the Marketing Club to 28 active members. She organises monthly industry speaker sessions.', expertise: ['Brand Strategy', 'Social Media', 'STP'], avatar: 'RO', joined: 'Jan 2025', sessionsHosted: 12, contributions: 34, topics: ['Marketing', 'Branding', 'Campaign Strategy', 'Social Media', 'Consumer Behaviour'] },
  { name: 'Sarah Chen', club: 'Leadership Club', clubId: 'cl-03', role: 'Leadership Coach', bio: 'Level 5 Operations Manager apprentice at Tesco. Sarah mentors 6 junior apprentices and leads the Leadership Club\'s peer coaching programme. Her sessions on emotional intelligence consistently receive outstanding feedback.', expertise: ['Coaching', 'Emotional Intelligence', 'Operations'], avatar: 'SC', joined: 'Feb 2025', sessionsHosted: 10, contributions: 21, topics: ['Leadership', 'Coaching', 'Personal Branding', 'Emotional Intelligence', 'Team Management'] },
  { name: 'Tom Whitfield', club: 'AI in Marketing', clubId: 'cl-07', role: 'Tech Ambassador', bio: 'Level 4 Marketing Executive at a London-based MarTech agency. Tom is KBC\'s youngest club ambassador and has built the AI in Marketing club from scratch. His hands-on labs are the highest-rated sessions across all clubs.', expertise: ['AI Tools', 'Marketing Automation', 'Analytics'], avatar: 'TW', joined: 'May 2026', sessionsHosted: 6, contributions: 29, topics: ['AI', 'Marketing Technology', 'Automation', 'Data Analytics', 'Innovation'] },
  { name: 'Priya Patel', club: 'Career Growth Club', clubId: 'cl-04', role: 'Career Ambassador', bio: 'Talent Acquisition Manager by background, now completing her Level 5 HR apprenticeship. Priya has reviewed over 200 apprentice CVs and runs the most-attended club events — her LinkedIn masterclass had 34 attendees.', expertise: ['CV Writing', 'Interview Skills', 'Personal Branding'], avatar: 'PP', joined: 'Jan 2025', sessionsHosted: 14, contributions: 27, topics: ['Career Development', 'CV Writing', 'Interview Skills', 'Personal Branding', 'Job Search'] },
  { name: 'David Thompson', club: 'British Values & Professional Practice', clubId: 'cl-05', role: 'Compliance Ambassador', bio: 'Level 4 Business Administrator at a Leeds-based legal firm. David brings a strong ethics background to his club leadership. His debate format has become the most requested activity across the learner community.', expertise: ['Ethics', 'Professional Standards', 'Debate Facilitation'], avatar: 'DT', joined: 'Apr 2025', sessionsHosted: 8, contributions: 18, topics: ['Ethics', 'Professional Standards', 'Compliance', 'Workplace Culture', 'Debate'] },
  { name: 'James Harrington', club: 'Project Controls Club', clubId: 'cl-02', role: 'Project Ambassador', bio: 'Level 4 Associate Project Manager working on infrastructure projects. James is PMP-certified and brings extensive practical knowledge to his sessions. He is developing a project simulation for club members.', expertise: ['Risk Management', 'Project Planning', 'Stakeholder Management'], avatar: 'JH', joined: 'Mar 2025', sessionsHosted: 7, contributions: 19, topics: ['Project Controls', 'Risk Management', 'Planning', 'Stakeholder Management', 'Infrastructure'] },
  { name: 'Dr. Amara Okafor', club: 'Sustainability in Business', clubId: 'cl-06', role: 'Sustainability Lead', bio: 'Level 6 degree apprentice in Environmental Management. With a background in environmental science, Amara leads compelling discussions on corporate sustainability and has connected the club with two industry ESG panels.', expertise: ['ESG', 'Carbon Footprinting', 'Green Marketing'], avatar: 'AO', joined: 'Mar 2025', sessionsHosted: 9, contributions: 16, topics: ['Sustainability', 'ESG', 'Green Business', 'Climate Change', 'Corporate Responsibility'] },
];

// ─── AMBASSADOR JOURNEY ───
export const AMBASSADOR_REQUIREMENTS = [
  { id: 'req-01', label: 'Attend Club Events', icon: 'ri-calendar-check-line', current: 2, target: 3, color: 'primary' as const },
  { id: 'req-02', label: 'Contribute Activities', icon: 'ri-flashlight-line', current: 3, target: 5, color: 'accent' as const },
  { id: 'req-03', label: 'Earn Community Points', icon: 'ri-coins-line', current: 320, target: 500, color: 'secondary' as const },
  { id: 'req-04', label: 'Receive Recommendation', icon: 'ri-thumb-up-line', current: 0, target: 1, color: 'primary' as const, isPending: true },
  { id: 'req-05', label: 'Community Participation', icon: 'ri-user-heart-line', current: 65, target: 100, color: 'accent' as const, isPercentage: true },
];

// ─── COMMUNITY FEED ───
export const FEED_ITEMS: FeedItem[] = [
  { id: 'feed-01', type: 'achievement', user: 'Sophie Williams', userAvatar: 'SW', userRole: 'Marketing Apprentice', club: 'Marketing Club', clubId: 'cl-01', content: 'Just completed the first draft of my personal development plan linking to KSB B1-B3. Happy to share my template with anyone working on theirs! 🎯', date: '12 Jun 2026', timeAgo: '1 day ago', likes: 24, comments: 8, joined: true },
  { id: 'feed-02', type: 'resource', user: 'Rebecca Okonkwo', userAvatar: 'RO', userRole: 'Club Ambassador', club: 'Marketing Club', clubId: 'cl-01', content: 'New resource uploaded: Complete STP Marketing Template Pack. Includes segmentation matrix, targeting scorecard, and positioning map — everything you need for your next campaign analysis. Download in the Resources tab.', date: '11 Jun 2026', timeAgo: '2 days ago', likes: 31, comments: 12, joined: true },
  { id: 'feed-03', type: 'event-recap', user: 'Tom Whitfield', userAvatar: 'TW', userRole: 'Club Ambassador', club: 'AI in Marketing', clubId: 'cl-07', content: 'Thank you to everyone who attended yesterday\'s AI Tools Lab! Recording is now available. Key takeaway: AI prompt engineering is becoming an essential marketing skill — start practicing now. Shared the exercise workbook in Resources.', date: '10 Jun 2026', timeAgo: '3 days ago', likes: 18, comments: 5, joined: true },
  { id: 'feed-04', type: 'discussion', user: 'Priya Patel', userAvatar: 'PP', userRole: 'Club Ambassador', club: 'Career Growth Club', clubId: 'cl-04', content: 'Discussion: What is the one skill you have developed during your apprenticeship that surprised you the most? For me, it has been stakeholder management — never expected to enjoy it this much! Share yours below 👇', date: '9 Jun 2026', timeAgo: '4 days ago', likes: 42, comments: 19, joined: false },
  { id: 'feed-05', type: 'badge', user: 'Marcus Webb', userAvatar: 'MW', userRole: 'Marketing Apprentice', club: 'Marketing Club', clubId: 'cl-01', content: 'Earned the Community Contributor badge! 50+ contributions across discussions, resources, and peer support. Thank you to everyone who has engaged with my posts — this community is incredible.', date: '8 Jun 2026', timeAgo: '5 days ago', likes: 37, comments: 14, joined: true },
  { id: 'feed-06', type: 'announcement', user: 'David Thompson', userAvatar: 'DT', userRole: 'Club Ambassador', club: 'British Values & Professional Practice', clubId: 'cl-05', content: 'Exciting announcement: We have secured a guest speaker from the Chartered Institute of Personnel and Development (CIPD) for our July session on professional ethics. Mark your calendars — 15 July, 16:00. Spaces limited to 25!', date: '7 Jun 2026', timeAgo: '6 days ago', likes: 28, comments: 9, joined: true },
  { id: 'feed-07', type: 'achievement', user: 'Olivia Park', userAvatar: 'OP', userRole: 'Marketing Apprentice', club: 'Marketing Club', clubId: 'cl-01', content: 'My workplace campaign just hit 10,000 organic impressions on Instagram! Applied everything I learned from Rebecca\'s social media strategy workshop. Proof that club learning translates directly to workplace results.', date: '6 Jun 2026', timeAgo: '1 week ago', likes: 45, comments: 16, joined: true },
  { id: 'feed-08', type: 'resource', user: 'Dr. Amara Okafor', userAvatar: 'AO', userRole: 'Club Ambassador', club: 'Sustainability in Business', clubId: 'cl-06', content: 'Shared: ESG Reporting Starter Guide for SMEs. A practical 20-page guide covering the basics of environmental, social, and governance reporting. Perfect for anyone whose workplace is starting their sustainability journey.', date: '5 Jun 2026', timeAgo: '1 week ago', likes: 22, comments: 7, joined: false },
];

// ─── COMMUNITY BADGES ───
export const COMMUNITY_BADGES: CommunityBadge[] = [
  { id: 'badge-01', title: 'Community Contributor', description: 'Make 10 contributions across discussions, resources, or events', icon: 'ri-star-line', color: 'primary', earned: true, earnedDate: 'May 2026' },
  { id: 'badge-02', title: 'Networking Champion', description: 'Attend 5 or more networking events across clubs', icon: 'ri-user-heart-line', color: 'accent', earned: true, earnedDate: 'Jun 2026' },
  { id: 'badge-03', title: 'Event Regular', description: 'Attend 10 club events', icon: 'ri-calendar-check-line', color: 'secondary', earned: true, earnedDate: 'Apr 2026' },
  { id: 'badge-04', title: 'Discussion Starter', description: 'Start 5 discussions that receive 10+ replies each', icon: 'ri-chat-1-line', color: 'primary', earned: false, progress: 3, progressTarget: 5, progressLabel: 'discussions' },
  { id: 'badge-05', title: 'Mentor Supporter', description: 'Provide peer support to 3 fellow learners', icon: 'ri-user-star-line', color: 'accent', earned: false, progress: 2, progressTarget: 3, progressLabel: 'learners supported' },
  { id: 'badge-06', title: 'Club Ambassador', description: 'Complete all ambassador programme requirements', icon: 'ri-shield-star-line', color: 'secondary', earned: false, progress: 65, progressTarget: 100, progressLabel: '% complete' },
  { id: 'badge-07', title: 'Peer Leader', description: 'Lead 3 club sessions or workshops', icon: 'ri-presentation-line', color: 'primary', earned: false, progress: 1, progressTarget: 3, progressLabel: 'sessions led' },
  { id: 'badge-08', title: 'Top Contributor', description: 'Rank in top 3 of monthly leaderboard', icon: 'ri-trophy-line', color: 'accent', earned: false, progress: 0, progressTarget: 1, progressLabel: 'times achieved' },
];

// ─── POINTS SYSTEM ───
export const POINT_RULES: PointRule[] = [
  { id: 'rule-01', action: 'Attend Events', description: 'Earn points for every club event you attend. Bonus points for networking events and panel discussions.', points: 50, icon: 'ri-calendar-event-line', color: 'accent' },
  { id: 'rule-02', action: 'Submit Activities', description: 'Complete community activities like reflections, resource sharing, and peer support.', points: 25, icon: 'ri-task-line', color: 'primary' },
  { id: 'rule-03', action: 'Support Learners', description: 'Help fellow learners through mentoring, peer review, or answering questions.', points: 80, icon: 'ri-user-heart-line', color: 'secondary' },
  { id: 'rule-04', action: 'Share Resources', description: 'Upload templates, guides, or tools that benefit the community.', points: 40, icon: 'ri-folder-upload-line', color: 'primary' },
  { id: 'rule-05', action: 'Join Discussions', description: 'Participate in club discussions with thoughtful contributions.', points: 30, icon: 'ri-chat-1-line', color: 'accent' },
  { id: 'rule-06', action: 'Become Ambassador', description: 'Complete the ambassador programme and earn ongoing recognition points.', points: 500, icon: 'ri-shield-star-line', color: 'secondary' },
];

// ─── POINTS HISTORY ───
export const POINTS_HISTORY = [
  { id: 'ph-01', action: 'Attended Social Media Strategy Workshop', club: 'Marketing Club', date: '12 Jun', points: 50 },
  { id: 'ph-02', action: 'Shared STP Marketing Template', club: 'Marketing Club', date: '11 Jun', points: 40 },
  { id: 'ph-03', action: 'Led Club Discussion on Campaign ROI', club: 'Marketing Club', date: '9 Jun', points: 60 },
  { id: 'ph-04', action: 'Attended Emotional Intelligence Workshop', club: 'Leadership Club', date: '8 Jun', points: 50 },
  { id: 'ph-05', action: 'Submitted Reflection on Workplace Experience', club: 'All Clubs', date: '7 Jun', points: 30 },
  { id: 'ph-06', action: 'Mentored Fellow Learner (1:1 Session)', club: 'Leadership Club', date: '5 Jun', points: 80 },
  { id: 'ph-07', action: 'Participated in Ethics Debate', club: 'British Values Club', date: '3 Jun', points: 30 },
  { id: 'ph-08', action: 'Uploaded Campaign Analytics Guide', club: 'AI in Marketing', date: '1 Jun', points: 40 },
];

// ─── COMMUNITY IMPACT ───
export const COMMUNITY_IMPACT = {
  eventsAttended: 14,
  activitiesCompleted: 9,
  discussionsJoined: 22,
  resourcesShared: 7,
  learnersSupported: 5,
  totalPoints: 850,
};

// ─── COMMUNITY STATS ───
export const COMMUNITY_STATS = {
  totalClubs: 7,
  myClubs: 4,
  communityPoints: 850,
  eventsThisMonth: 18,
  activeLearners: 120,
  communityDiscussions: 340,
};

export interface ClubMember {
  id: string;
  name: string;
  avatar: string;
  role: string;
  joinedDate: string;
  contributions: number;
  isAmbassador: boolean;
}

export interface ClubDiscussion {
  id: string;
  clubId: string;
  title: string;
  author: string;
  authorAvatar: string;
  date: string;
  timeAgo: string;
  content: string;
  replies: number;
  likes: number;
  category: string;
  shareCount?: number;
  isLiked?: boolean;
}

export interface DiscussionReply {
  id: string;
  author: string;
  authorAvatar: string;
  content: string;
  date: string;
  timeAgo: string;
  likes: number;
  isLiked?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  dayName: string;
  time: string;
  club: string;
  clubId: string;
  type: string;
  format: string;
  location: string;
  host: string;
  points: number;
  status: 'confirmed' | 'pending';
  description: string;
  color?: string;
  reminderMinutes?: number;
}

export interface ClubResource {
  id: string;
  clubId: string;
  title: string;
  description: string;
  type: string;
  uploadedBy: string;
  uploadedDate: string;
  downloads: number;
  icon: string;
  fileSize: string;
}

export interface CommentItem {
  id: string;
  feedId?: string;
  discussionId?: string;
  author: string;
  authorAvatar: string;
  content: string;
  date: string;
  timeAgo: string;
  likes: number;
  isLiked: boolean;
}

export interface EnhancedBadge {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: 'primary' | 'accent' | 'secondary';
  earned: boolean;
  progress?: number;
  progressTarget?: number;
  progressLabel?: string;
  earnedDate?: string;
  impact: string;
  unlockCriteria: string[];
}

// ─── CLUB MEMBERS ───
export const CLUB_MEMBERS: ClubMember[] = [
  { id: 'm-01', name: 'Rebecca Okonkwo', avatar: 'RO', role: 'Club Ambassador', joinedDate: 'Jan 2025', contributions: 34, isAmbassador: true },
  { id: 'm-02', name: 'Sophie Williams', avatar: 'SW', role: 'Marketing Apprentice', joinedDate: 'Mar 2025', contributions: 22, isAmbassador: false },
  { id: 'm-03', name: 'Marcus Webb', avatar: 'MW', role: 'Marketing Apprentice', joinedDate: 'Feb 2025', contributions: 15, isAmbassador: false },
  { id: 'm-04', name: 'Olivia Park', avatar: 'OP', role: 'Marketing Apprentice', joinedDate: 'Apr 2025', contributions: 13, isAmbassador: false },
  { id: 'm-05', name: 'Liam Foster', avatar: 'LF', role: 'Marketing Apprentice', joinedDate: 'May 2025', contributions: 11, isAmbassador: false },
  { id: 'm-06', name: 'Sarah Chen', avatar: 'SC', role: 'Leadership Coach / Ambassador', joinedDate: 'Feb 2025', contributions: 21, isAmbassador: true },
  { id: 'm-07', name: 'Tom Whitfield', avatar: 'TW', role: 'Tech Ambassador', joinedDate: 'May 2026', contributions: 29, isAmbassador: true },
  { id: 'm-08', name: 'Priya Patel', avatar: 'PP', role: 'Career Ambassador', joinedDate: 'Jan 2025', contributions: 27, isAmbassador: true },
  { id: 'm-09', name: 'David Thompson', avatar: 'DT', role: 'Compliance Ambassador', joinedDate: 'Apr 2025', contributions: 18, isAmbassador: true },
  { id: 'm-10', name: 'James Harrington', avatar: 'JH', role: 'Project Ambassador', joinedDate: 'Mar 2025', contributions: 19, isAmbassador: true },
  { id: 'm-11', name: 'Dr. Amara Okafor', avatar: 'AO', role: 'Sustainability Lead', joinedDate: 'Mar 2025', contributions: 16, isAmbassador: true },
  { id: 'm-12', name: 'Chloe Parkinson', avatar: 'CP', role: 'Leadership Apprentice', joinedDate: 'Mar 2025', contributions: 14, isAmbassador: false },
  { id: 'm-13', name: 'Alex Kimani', avatar: 'AK', role: 'Marketing Apprentice', joinedDate: 'Jun 2025', contributions: 9, isAmbassador: false },
  { id: 'm-14', name: 'Fatima Hassan', avatar: 'FH', role: 'Marketing Apprentice', joinedDate: 'Apr 2025', contributions: 7, isAmbassador: false },
  { id: 'm-15', name: 'Ryan O\'Connor', avatar: 'RC', role: 'Sustainability Apprentice', joinedDate: 'May 2025', contributions: 8, isAmbassador: false },
  { id: 'm-16', name: 'Emma Lewis', avatar: 'EL', role: 'AI Marketing Apprentice', joinedDate: 'May 2026', contributions: 12, isAmbassador: false },
  { id: 'm-17', name: 'Daniel Park', avatar: 'DP', role: 'Project Controls Apprentice', joinedDate: 'Apr 2025', contributions: 10, isAmbassador: false },
  { id: 'm-18', name: 'Zara Mahmood', avatar: 'ZM', role: 'Career Growth Apprentice', joinedDate: 'Feb 2025', contributions: 16, isAmbassador: false },
];

// ─── CLUB DISCUSSIONS ───
export const CLUB_DISCUSSIONS: ClubDiscussion[] = [
  { id: 'disc-01', clubId: 'cl-01', title: 'Campaign ROI frameworks — what metrics do you track?', author: 'Rebecca Okonkwo', authorAvatar: 'RO', date: '12 Jun 2026', timeAgo: '1 day ago', content: 'I\'ve been experimenting with different ROI frameworks for our campaigns. We\'ve moved from just tracking impressions to measuring actual pipeline impact. I\'d love to hear what metrics everyone else is using. At Unilever we now track brand consideration lift alongside direct response metrics — the combination gives a much fuller picture of campaign effectiveness.', replies: 7, likes: 14, category: 'Strategy' },
  { id: 'disc-02', clubId: 'cl-01', title: 'STP segmentation approaches — practical tips for B2B vs B2C', author: 'Sophie Williams', authorAvatar: 'SW', date: '10 Jun 2026', timeAgo: '3 days ago', content: 'I\'m working on a segmentation project at work and finding that the B2B approach is fundamentally different from B2C. In B2B we\'re looking at firmographics, decision-making units, and procurement cycles — whereas B2C is more about lifestyle, behaviour, and psychographics. Anyone else navigating both? Would love to swap frameworks.', replies: 11, likes: 19, category: 'Best Practice' },
  { id: 'disc-03', clubId: 'cl-01', title: 'Social media trends 2026 — what is actually working?', author: 'Marcus Webb', authorAvatar: 'MW', date: '8 Jun 2026', timeAgo: '5 days ago', content: 'TikTok is still dominating organic reach but I\'m seeing LinkedIn explode for B2B. Our company page grew 300% in 6 months just from consistent thought leadership content. Is anyone else seeing this shift? Also curious about AI-generated content — are you using it? How transparent are you being about it?', replies: 15, likes: 24, category: 'Trends' },
  { id: 'disc-04', clubId: 'cl-01', title: 'ChatGPT for content ideation — share your prompts', author: 'Olivia Park', authorAvatar: 'OP', date: '7 Jun 2026', timeAgo: '6 days ago', content: 'I\'ve built a really effective prompt template for blog outlines. It goes: "You are a senior marketing strategist. Generate 10 blog post angles on [topic] targeting [audience]. For each angle, provide: 1) working title, 2) key message, 3) target keyword, 4) estimated word count." Sharing this because it\'s saved me hours! What prompts are working for you?', replies: 9, likes: 18, category: 'Tools' },
  { id: 'disc-05', clubId: 'cl-01', title: 'Marketing Club monthly showcase — July submissions thread', author: 'Rebecca Okonkwo', authorAvatar: 'RO', date: '5 Jun 2026', timeAgo: '1 week ago', content: 'July showcase is open for submissions! We\'re looking for campaign case studies, creative portfolio pieces, and data analysis projects. Deadline is 28 June. Top 3 presenters get bonus community points and a feature in the monthly newsletter. Drop your submission ideas below!', replies: 4, likes: 8, category: 'Announcement' },
  { id: 'disc-06', clubId: 'cl-03', title: 'Situational leadership models — which one do you use?', author: 'Sarah Chen', authorAvatar: 'SC', date: '11 Jun 2026', timeAgo: '2 days ago', content: 'I\'ve been applying Hersey-Blanchard\'s Situational Leadership model in my team at Tesco and it\'s been transformative. Matching leadership style to team member readiness levels has reduced my micromanaging habit significantly. But I know there are other models out there — Path-Goal, Vroom-Yetton, etc. What\'s working for everyone?', replies: 7, likes: 12, category: 'Theory' },
  { id: 'disc-07', clubId: 'cl-03', title: 'Leading with emotional intelligence — workshop follow-up', author: 'Chloe Parkinson', authorAvatar: 'CP', date: '9 Jun 2026', timeAgo: '4 days ago', content: 'The EI workshop was incredible! I\'ve been practicing the "pause and name" technique Sarah taught us — before reacting, pause for 3 seconds and mentally name the emotion you\'re feeling. Already used it twice in team meetings and it completely changed my response. Has anyone else tried it? What other EI techniques are you finding useful?', replies: 10, likes: 21, category: 'Workshop Follow-up' },
  { id: 'disc-08', clubId: 'cl-07', title: 'ChatGPT for content ideation — share your best prompts', author: 'Tom Whitfield', authorAvatar: 'TW', date: '10 Jun 2026', timeAgo: '3 days ago', content: 'Since our last lab session, I\'ve been building a prompt library. My current favourite for audience persona research: "Act as a market researcher. Based on [product description], create 3 detailed buyer personas including demographics, psychographics, pain points, and preferred content channels." Drop your best prompts in the thread!', replies: 9, likes: 16, category: 'Tools' },
  { id: 'disc-09', clubId: 'cl-06', title: 'Green marketing — authenticity vs greenwashing debate', author: 'Dr. Amara Okafor', authorAvatar: 'AO', date: '8 Jun 2026', timeAgo: '5 days ago', content: 'Following up on our panel discussion: what are the biggest greenwashing red flags you\'ve spotted in the wild? I saw a brand claim "100% eco-friendly packaging" when only the outer box was recyclable and everything inside was plastic. Share your examples — let\'s build a spotting guide together.', replies: 13, likes: 28, category: 'Debate' },
  { id: 'disc-10', clubId: 'cl-05', title: 'Privacy vs monitoring — where is the ethical line?', author: 'David Thompson', authorAvatar: 'DT', date: '7 Jun 2026', timeAgo: '6 days ago', content: 'Our debate last month sparked so many interesting perspectives. I want to dig deeper: with remote work monitoring tools becoming more common, where do we draw the ethical line between legitimate performance management and surveillance? Let\'s discuss specific scenarios and find consensus on principles.', replies: 11, likes: 17, category: 'Ethics' },
];

// ─── CLUB RESOURCES ───
export const CLUB_RESOURCES: ClubResource[] = [
  { id: 'res-01', clubId: 'cl-01', title: 'STP Marketing Template Pack', description: 'Complete template pack including segmentation matrix, targeting scorecard, and positioning map — everything you need for your next campaign analysis.', type: 'Template', uploadedBy: 'Rebecca Okonkwo', uploadedDate: '11 Jun 2026', downloads: 34, icon: 'ri-file-text-line', fileSize: '2.4 MB' },
  { id: 'res-02', clubId: 'cl-01', title: 'Campaign ROI Calculator', description: 'Excel spreadsheet with pre-built formulas to calculate ROI across multiple campaign channels. Includes comparison dashboard and trend analysis.', type: 'Tool', uploadedBy: 'Sophie Williams', uploadedDate: '5 Jun 2026', downloads: 28, icon: 'ri-file-excel-2-line', fileSize: '1.8 MB' },
  { id: 'res-03', clubId: 'cl-01', title: 'Social Media Content Calendar', description: '12-month content calendar template with best-practice posting frequencies, content pillars, and engagement tracking.', type: 'Template', uploadedBy: 'Marcus Webb', uploadedDate: '3 Jun 2026', downloads: 22, icon: 'ri-calendar-line', fileSize: '1.2 MB' },
  { id: 'res-04', clubId: 'cl-01', title: 'Brand Voice Guidelines Framework', description: 'Step-by-step framework for developing consistent brand voice guidelines. Includes tone matrix, vocabulary examples, and competitor analysis template.', type: 'Guide', uploadedBy: 'Rebecca Okonkwo', uploadedDate: '28 May 2026', downloads: 19, icon: 'ri-book-open-line', fileSize: '3.1 MB' },
  { id: 'res-05', clubId: 'cl-01', title: 'Marketing Analytics Dashboard', description: 'Power BI template with pre-configured dashboards for campaign performance, channel attribution, and audience insights.', type: 'Tool', uploadedBy: 'Olivia Park', uploadedDate: '25 May 2026', downloads: 16, icon: 'ri-bar-chart-2-line', fileSize: '5.6 MB' },
  { id: 'res-06', clubId: 'cl-03', title: 'Emotional Intelligence Self-Assessment', description: 'Comprehensive self-assessment tool based on Goleman\'s EI framework. Includes scoring guide and development action plan template.', type: 'Assessment', uploadedBy: 'Sarah Chen', uploadedDate: '8 Jun 2026', downloads: 26, icon: 'ri-psychotherapy-line', fileSize: '1.5 MB' },
  { id: 'res-07', clubId: 'cl-03', title: 'Leadership Styles Cheat Sheet', description: 'One-page reference covering 6 leadership styles with pros, cons, and best-use scenarios. Perfect for quick reference before team meetings.', type: 'Guide', uploadedBy: 'Sarah Chen', uploadedDate: '1 Jun 2026', downloads: 31, icon: 'ri-file-list-3-line', fileSize: '0.8 MB' },
  { id: 'res-08', clubId: 'cl-07', title: 'AI Prompt Engineering Workbook', description: 'Hands-on workbook from the AI Tools Lab. Includes 20 prompt templates, optimisation techniques, and practical exercises for marketing use cases.', type: 'Workbook', uploadedBy: 'Tom Whitfield', uploadedDate: '10 Jun 2026', downloads: 42, icon: 'ri-robot-line', fileSize: '4.2 MB' },
  { id: 'res-09', clubId: 'cl-07', title: 'Marketing AI Tools Comparison 2026', description: 'Comprehensive comparison of 15 AI marketing tools including features, pricing, integration capabilities, and real user reviews from club members.', type: 'Report', uploadedBy: 'Emma Lewis', uploadedDate: '5 Jun 2026', downloads: 38, icon: 'ri-survey-line', fileSize: '2.9 MB' },
  { id: 'res-10', clubId: 'cl-06', title: 'ESG Reporting Starter Guide for SMEs', description: '20-page practical guide covering the basics of environmental, social, and governance reporting. Includes template frameworks and KPI tracking sheets.', type: 'Guide', uploadedBy: 'Dr. Amara Okafor', uploadedDate: '5 Jun 2026', downloads: 24, icon: 'ri-leaf-line', fileSize: '3.4 MB' },
  { id: 'res-11', clubId: 'cl-04', title: 'CV and Cover Letter Masterclass Slides', description: 'Presentation slides from Priya\'s popular career workshop. Includes CV templates, cover letter frameworks, and recruiter insights.', type: 'Presentation', uploadedBy: 'Priya Patel', uploadedDate: '15 May 2026', downloads: 45, icon: 'ri-slideshow-line', fileSize: '6.1 MB' },
  { id: 'res-12', clubId: 'cl-04', title: 'Mock Interview Question Bank', description: 'Curated collection of 50 mock interview questions across competency, technical, and behavioural categories. Includes model answer frameworks.', type: 'Guide', uploadedBy: 'Priya Patel', uploadedDate: '10 May 2026', downloads: 39, icon: 'ri-question-answer-line', fileSize: '1.9 MB' },
  { id: 'res-13', clubId: 'cl-02', title: 'Project Risk Register Template', description: 'Comprehensive risk register with pre-configured risk categories, probability-impact matrix, and automated RAG status indicators.', type: 'Template', uploadedBy: 'James Harrington', uploadedDate: '3 Jun 2026', downloads: 18, icon: 'ri-shield-line', fileSize: '2.1 MB' },
  { id: 'res-14', clubId: 'cl-05', title: 'Ethical Decision-Making Framework', description: 'Structured decision-making framework for navigating ethical dilemmas in the workplace. Includes case studies and discussion prompts.', type: 'Framework', uploadedBy: 'David Thompson', uploadedDate: '20 May 2026', downloads: 15, icon: 'ri-scales-line', fileSize: '1.7 MB' },
];

// ─── ENHANCED COMMUNITY BADGES (with impact + unlock criteria) ───
export const ENHANCED_COMMUNITY_BADGES: EnhancedBadge[] = [
  {
    id: 'badge-01', title: 'Community Contributor', description: 'Make 10 contributions across discussions, resources, or events', icon: 'ri-star-line', color: 'primary', earned: true, earnedDate: 'May 2026',
    impact: 'Community Contributors are the lifeblood of the KBC learner community. By sharing your knowledge, resources, and experiences, you help fellow apprentices overcome challenges and accelerate their learning. Your 10 contributions have directly supported at least 15 other learners across multiple clubs.',
    unlockCriteria: ['Start 3 discussion threads', 'Upload 2 resources to the resource library', 'Comment on 5 existing discussions', 'Receive at least 10 likes across your contributions'],
  },
  {
    id: 'badge-02', title: 'Networking Champion', description: 'Attend 5 or more networking events across clubs', icon: 'ri-user-heart-line', color: 'accent', earned: true, earnedDate: 'Jun 2026',
    impact: 'Networking Champions build the connections that make the KBC community thrive. By attending events across multiple clubs, you have expanded your professional network beyond your immediate cohort and programme. Apprentices who network actively are 40% more likely to secure permanent roles with their employer after EPA.',
    unlockCriteria: ['Attend at least 5 club events', 'Events must span at least 2 different clubs', 'Participate in the networking brunch (in-person event)', 'Complete event feedback forms for all attended events'],
  },
  {
    id: 'badge-03', title: 'Event Regular', description: 'Attend 10 club events', icon: 'ri-calendar-check-line', color: 'secondary', earned: true, earnedDate: 'Apr 2026',
    impact: 'Event Regulars demonstrate commitment to continuous professional development. Each event you attend adds to your knowledge, skills, and behaviours — directly contributing to your EPA readiness. Your attendance record shows the consistency that employers and assessors look for in outstanding apprentices.',
    unlockCriteria: ['Attend 10 club events across any clubs', 'Maintain at least 80% attendance rate', 'Ask or answer at least one question per event', 'Collect at least 500 event points'],
  },
  {
    id: 'badge-04', title: 'Discussion Starter', description: 'Start 5 discussions that receive 10+ replies each', icon: 'ri-chat-1-line', color: 'primary', earned: false, progress: 3, progressTarget: 5, progressLabel: 'discussions',
    impact: 'Discussion Starters spark the conversations that drive community learning. High-engagement discussions often become reference resources that apprentices return to months later. Starting quality discussions develops your thought leadership skills — increasingly valued by employers in the modern workplace.',
    unlockCriteria: ['Start 5 discussion threads', 'Each thread must receive 10+ replies from unique members', 'Actively engage with and respond to replies', 'At least 2 discussions must span different topic categories'],
  },
  {
    id: 'badge-05', title: 'Mentor Supporter', description: 'Provide peer support to 3 fellow learners', icon: 'ri-user-star-line', color: 'accent', earned: false, progress: 2, progressTarget: 3, progressLabel: 'learners supported',
    impact: 'Mentor Supporters go beyond their own learning to lift others up. Peer mentoring is one of the most effective forms of development — teaching others reinforces your own understanding. Learners who mentor peers consistently score 15% higher on knowledge assessments.',
    unlockCriteria: ['Provide 1:1 support to 3 different learners', 'Each mentoring session must be at least 30 minutes', 'Receive positive feedback from mentees', 'Share mentoring reflections in the community feed'],
  },
  {
    id: 'badge-06', title: 'Club Ambassador', description: 'Complete all ambassador programme requirements', icon: 'ri-shield-star-line', color: 'secondary', earned: false, progress: 65, progressTarget: 100, progressLabel: '% complete',
    impact: 'Club Ambassadors are the leaders who shape the future of the KBC learner community. Ambassadors gain exclusive access to leadership development workshops, industry networking events, and direct mentorship from KBC senior leadership. Ambassador experience is highly valued by employers and significantly strengthens your CV.',
    unlockCriteria: ['Attend 3 club events (2/3)', 'Contribute 5 community activities (3/5)', 'Earn 500 community points (320/500)', 'Receive a recommendation from a current ambassador', 'Achieve at least 100% community participation score (65%)'],
  },
  {
    id: 'badge-07', title: 'Peer Leader', description: 'Lead 3 club sessions or workshops', icon: 'ri-presentation-line', color: 'primary', earned: false, progress: 1, progressTarget: 3, progressLabel: 'sessions led',
    impact: 'Peer Leaders develop the facilitation and presentation skills that distinguish high-performing professionals. Leading sessions builds confidence, communication ability, and subject matter authority. These are exactly the behaviours that EPA assessors look for when awarding Distinction grades.',
    unlockCriteria: ['Lead 3 club sessions as the primary facilitator', 'Prepare session materials and activities', 'Receive average rating of 4+ from session feedback', 'At least one session must involve interactive group work'],
  },
  {
    id: 'badge-08', title: 'Top Contributor', description: 'Rank in top 3 of monthly leaderboard', icon: 'ri-trophy-line', color: 'accent', earned: false, progress: 0, progressTarget: 1, progressLabel: 'times achieved',
    impact: 'Top Contributors set the standard for community engagement. Ranking in the top 3 requires sustained excellence across events, activities, discussions, and peer support. This badge signals to employers and coaches that you are in the top tier of engaged apprentices — the kind of profile that attracts promotion opportunities.',
    unlockCriteria: ['Achieve top 3 ranking on the monthly leaderboard', 'Maintain active participation across the full calendar month', 'Contribute across at least 3 different engagement categories', 'Earn a minimum of 200 points in the qualifying month'],
  },
];

// ─── CLUB EVENTS BY CLUB ID ───
export function getEventsByClubId(clubId: string): ClubEvent[] {
  return EVENTS.filter((e) => e.clubId === clubId);
}

export function getMembersByClub(club: CommunityClub): ClubMember[] {
  // Return relevant members based on club context — here we return a subset per club
  const memberMap: Record<string, number[]> = {
    'cl-01': [1, 2, 3, 4, 5, 13, 14],
    'cl-02': [10, 17],
    'cl-03': [6, 12],
    'cl-04': [8, 18],
    'cl-05': [9],
    'cl-06': [11, 15],
    'cl-07': [7, 16],
  };
  const indices = memberMap[club.id] || [];
  return indices.map((i) => CLUB_MEMBERS[i - 1]).filter(Boolean);
}

export function getDiscussionsByClubId(clubId: string): ClubDiscussion[] {
  return CLUB_DISCUSSIONS.filter((d) => d.clubId === clubId);
}

export function getResourcesByClubId(clubId: string): ClubResource[] {
  return CLUB_RESOURCES.filter((r) => r.clubId === clubId);
}

// ─── DISCUSSION REPLIES ───
export const DISCUSSION_REPLIES: Record<string, DiscussionReply[]> = {
  'disc-01': [
    { id: 'rpl-101', author: 'Sophie Williams', authorAvatar: 'SW', content: 'At our company we track ROAS, CPA, and LTV:CAC ratio. The last one really helps sell the long-term value to leadership.', date: '12 Jun 2026', timeAgo: '1 day ago', likes: 5, isLiked: false },
    { id: 'rpl-102', author: 'Marcus Webb', authorAvatar: 'MW', content: 'I have started looking at incrementality testing using geo-holdouts. It completely changes how you think about ROI.', date: '12 Jun 2026', timeAgo: '1 day ago', likes: 8, isLiked: false },
    { id: 'rpl-103', author: 'Tom Whitfield', authorAvatar: 'TW', content: 'Great point on brand consideration! We are now using brand lift surveys pre/post campaign for B2B — so much more insightful than just MQLs.', date: '12 Jun 2026', timeAgo: '23 hours ago', likes: 3, isLiked: false },
  ],
  'disc-02': [
    { id: 'rpl-201', author: 'Rebecca Okonkwo', authorAvatar: 'RO', content: 'For B2B segmentation, I highly recommend adding "buying stage" as a dimension — awareness, consideration, decision. Changed everything for our ABM campaigns.', date: '10 Jun 2026', timeAgo: '3 days ago', likes: 7, isLiked: false },
    { id: 'rpl-202', author: 'Olivia Park', authorAvatar: 'OP', content: 'B2C psychographics are powerful but expensive to gather. We use social listening data as a proxy for lifestyle segmentation — not perfect but directionally accurate.', date: '10 Jun 2026', timeAgo: '3 days ago', likes: 6, isLiked: false },
  ],
  'disc-03': [
    { id: 'rpl-301', author: 'Emma Lewis', authorAvatar: 'EL', content: 'LinkedIn is absolutely exploding for B2B! Our organic reach increased 5x since we started posting 3x per week. The algorithm rewards consistency so much more than TikTok now.', date: '8 Jun 2026', timeAgo: '5 days ago', likes: 12, isLiked: false },
    { id: 'rpl-302', author: 'Rebecca Okonkwo', authorAvatar: 'RO', content: 'On AI content — we disclose when AI helped with research or drafting, but ALL final content is human-edited. Transparency builds trust. Our audience actually engages MORE with disclosed AI-assisted content.', date: '8 Jun 2026', timeAgo: '5 days ago', likes: 15, isLiked: false },
    { id: 'rpl-303', author: 'Priya Patel', authorAvatar: 'PP', content: 'TikTok is still winning for consumer brands but the content quality bar keeps rising. Raw iPhone videos used to work, now you need proper lighting and editing. The era of casual TikTok content is ending.', date: '8 Jun 2026', timeAgo: '4 days ago', likes: 9, isLiked: false },
  ],
  'disc-04': [
    { id: 'rpl-401', author: 'Tom Whitfield', authorAvatar: 'TW', content: 'Brilliant prompt template Olivia! I modified it to include competitor analysis — adding "For each angle, also suggest a unique angle that competitor X has NOT covered yet." Works wonders.', date: '7 Jun 2026', timeAgo: '6 days ago', likes: 11, isLiked: false },
  ],
  'disc-06': [
    { id: 'rpl-601', author: 'Chloe Parkinson', authorAvatar: 'CP', content: 'Hersey-Blanchard is great but I find the Path-Goal model more practical for day-to-day management. It focuses on clearing obstacles for your team — which is honestly 80% of leadership.', date: '11 Jun 2026', timeAgo: '2 days ago', likes: 4, isLiked: false },
    { id: 'rpl-602', author: 'David Thompson', authorAvatar: 'DT', content: 'I use a blend — situational for performance conversations, servant leadership for 1:1s, and directive for crisis moments. One model can not fit every context.', date: '11 Jun 2026', timeAgo: '1 day ago', likes: 6, isLiked: false },
  ],
  'disc-07': [
    { id: 'rpl-701', author: 'Sarah Chen', authorAvatar: 'SC', content: 'So glad you found the pause technique useful Chloe! Another one I use is "emotion labelling" — when you feel tension rising, mentally say "I am feeling frustrated right now." Just naming it reduces its intensity by about 40% according to neuroscience research.', date: '9 Jun 2026', timeAgo: '4 days ago', likes: 14, isLiked: false },
  ],
  'disc-09': [
    { id: 'rpl-901', author: 'Ryan O\'Connor', authorAvatar: 'RC', content: 'Saw a fashion brand claim "sustainable collection" — turned out it was 8 items out of a 500-product catalogue. That is the laziest greenwashing I have ever seen.', date: '8 Jun 2026', timeAgo: '5 days ago', likes: 18, isLiked: false },
    { id: 'rpl-902', author: 'Dr. Amara Okafor', authorAvatar: 'AO', content: 'The worst I have seen is "carbon neutral" claims based entirely on offsetting with unverified credits. No actual emissions reduction. The ASA is cracking down hard on this now — brands should be very careful.', date: '8 Jun 2026', timeAgo: '5 days ago', likes: 22, isLiked: false },
  ],
  'disc-08': [
    { id: 'rpl-801', author: 'Emma Lewis', authorAvatar: 'EL', content: 'My favourite: "Act as a focus group of 5 marketing managers. I will describe a campaign idea. Give me their honest reactions, objections, and suggestions." Incredible for pre-testing concepts.', date: '10 Jun 2026', timeAgo: '3 days ago', likes: 9, isLiked: false },
  ],
  'disc-05': [
    { id: 'rpl-501', author: 'Olivia Park', authorAvatar: 'OP', content: 'I am submitting my influencer marketing campaign case study! Reached 50K impressions on a £200 budget — showing that creativity beats budget every time.', date: '5 Jun 2026', timeAgo: '1 week ago', likes: 7, isLiked: false },
  ],
  'disc-10': [
    { id: 'rpl-1001', author: 'James Harrington', authorAvatar: 'JH', content: 'The line for me is intent vs capability. Monitoring output (completed tasks, quality) is legitimate management. Monitoring keystrokes, mouse movements, or webcam access crosses into surveillance. Intent matters enormously.', date: '7 Jun 2026', timeAgo: '6 days ago', likes: 13, isLiked: false },
    { id: 'rpl-1002', author: 'Sarah Chen', authorAvatar: 'SC', content: 'Transparency is key — if monitoring exists, employees must know exactly what is tracked and why. Secret monitoring destroys psychological safety and is almost never ethically justifiable outside of security-critical roles.', date: '6 Jun 2026', timeAgo: '1 week ago', likes: 16, isLiked: false },
  ],
};

// ─── CALENDAR EVENTS (Learner Calendar) ───
export const CALENDAR_EVENTS: CalendarEvent[] = [
  { id: 'cal-01', title: 'Social Media Strategy Workshop', date: '20 Jun', dayName: 'Fri', time: '15:00–16:30', club: 'Marketing Club', clubId: 'cl-01', type: 'Workshop', format: 'Interactive Teams', location: 'Microsoft Teams', host: 'Rebecca Okonkwo', points: 50, status: 'confirmed', description: 'Build a complete social media strategy from scratch. Bring your workplace examples — we will workshop real campaigns together with peer feedback.' },
  { id: 'cal-02', title: 'Leading with Emotional Intelligence', date: '15 Jun', dayName: 'Sun', time: '16:00–17:00', club: 'Leadership Club', clubId: 'cl-03', type: 'Workshop', format: 'Teams Live', location: 'Microsoft Teams', host: 'Sarah Chen', points: 50, status: 'confirmed', description: 'Explore emotional intelligence frameworks and how to apply them in your daily leadership practice. Includes interactive group exercises and real workplace scenarios.' },
  { id: 'cal-03', title: 'AI Tools for Campaign Analytics', date: '25 Jun', dayName: 'Wed', time: '14:00–15:00', club: 'AI in Marketing', clubId: 'cl-07', type: 'Hands-on Lab', format: 'Interactive Teams', location: 'Microsoft Teams', host: 'Tom Whitfield', points: 50, status: 'confirmed', description: 'Hands-on lab exploring AI-powered analytics tools. Build a campaign dashboard using real data and AI-assisted insights generation.' },
  { id: 'cal-04', title: 'Ethical Decision-Making Workshop', date: '29 Jun', dayName: 'Sun', time: '15:30–17:00', club: 'British Values & Professional Practice', clubId: 'cl-05', type: 'Workshop', format: 'Teams Live', location: 'Microsoft Teams', host: 'David Thompson', points: 50, status: 'confirmed', description: 'Interactive workshop exploring real ethical dilemmas faced in UK workplaces.' },
  { id: 'cal-05', title: 'Marketing Club Monthly Showcase', date: '2 Jul', dayName: 'Wed', time: '13:00–14:00', club: 'Marketing Club', clubId: 'cl-01', type: 'Showcase', format: 'Teams Live', location: 'Microsoft Teams', host: 'Club Members', points: 50, status: 'confirmed', description: 'Monthly showcase where club members present their best campaign work.' },
  { id: 'cal-06', title: 'AI Ethics Panel Discussion', date: '8 Jul', dayName: 'Tue', time: '17:00–18:00', club: 'AI in Marketing', clubId: 'cl-07', type: 'Panel Discussion', format: 'Teams Live', location: 'Microsoft Teams', host: 'Tom Whitfield', points: 75, status: 'confirmed', description: 'Expert panel discussing the ethical implications of AI in marketing.' },
  { id: 'cal-07', title: 'Revision Session: Marketing Principles', date: '12 Jul', dayName: 'Sat', time: '11:00–12:00', club: 'Marketing Club', clubId: 'cl-01', type: 'Study Group', format: 'Teams Live', location: 'Microsoft Teams', host: 'Rebecca Okonkwo', points: 50, status: 'confirmed', description: 'Group revision session covering key marketing principles for upcoming assessments.' },
  { id: 'cal-08', title: 'Monthly Coaching Session', date: '18 Jun', dayName: 'Wed', time: '10:00–11:00', club: 'Coaching', clubId: '', type: 'Coaching', format: '1:1 Teams', location: 'Microsoft Teams', host: 'Coach James', points: 0, status: 'confirmed', description: 'Monthly progress review and coaching session with your dedicated skills coach.' },
  { id: 'cal-09', title: 'Gateway Readiness Check', date: '5 Jul', dayName: 'Sat', time: '14:00–14:30', club: 'Gateway', clubId: '', type: 'Assessment', format: '1:1 Teams', location: 'Microsoft Teams', host: 'Gateway Assessor', points: 0, status: 'pending', description: 'Check your readiness for Gateway. Review KSB evidence, OTJH completion, and discuss any gaps.' },
];

export function getDiscussionReplies(discussionId: string): DiscussionReply[] {
  return DISCUSSION_REPLIES[discussionId] || [];
}

export function getCalendarEventsByMonth(month: number): CalendarEvent[] {
  return CALENDAR_EVENTS.filter((ev) => {
    const m = parseInt(ev.date.split(' ')[0]);
    return m >= (month - 1) * 5 && m <= month * 5 + 5;
  });
}

// ─── EVENT FEEDBACK ───
export const EVENT_FEEDBACKS: EventFeedback[] = [
  { id: 'fb-01', eventId: 'ev-01', eventTitle: 'Leading with Emotional Intelligence', clubName: 'Leadership Club', eventDate: '15 Jun 2026', rating: 5, comment: 'Sarah was an incredible facilitator. The pause-and-name technique has genuinely changed how I handle difficult conversations at work. Already recommended to my entire cohort!', submittedBy: 'Sophie Williams', submittedDate: '16 Jun 2026', timeAgo: '2 days after' },
  { id: 'fb-02', eventId: 'ev-01', eventTitle: 'Leading with Emotional Intelligence', clubName: 'Leadership Club', eventDate: '15 Jun 2026', rating: 4, comment: 'Really practical content. Would have loved more time for the role-play exercises — 90 minutes instead of 60 would be perfect for the depth of material.', submittedBy: 'Chloe Parkinson', submittedDate: '16 Jun 2026', timeAgo: '2 days after' },
  { id: 'fb-03', eventId: 'ev-03', eventTitle: 'Social Media Strategy Workshop', clubName: 'Marketing Club', eventDate: '20 Jun 2026', rating: 5, comment: 'The hands-on format was fantastic. Built an actual strategy for my workplace campaign and got real-time feedback from Rebecca and peers. Walked away with a deliverable!', submittedBy: 'Marcus Webb', submittedDate: '21 Jun 2026', timeAgo: '1 day after' },
  { id: 'fb-04', eventId: 'ev-03', eventTitle: 'Social Media Strategy Workshop', clubName: 'Marketing Club', eventDate: '20 Jun 2026', rating: 5, comment: 'Best workshop I have attended at KBC. The template pack alone is worth 10x the time investment. Rebecca is a phenomenal teacher.', submittedBy: 'Olivia Park', submittedDate: '21 Jun 2026', timeAgo: '1 day after' },
  { id: 'fb-05', eventId: 'ev-03', eventTitle: 'Social Media Strategy Workshop', clubName: 'Marketing Club', eventDate: '20 Jun 2026', rating: 4, comment: 'Excellent content and delivery. Only minor feedback: the breakout room exercise felt rushed — maybe extend to 20 minutes next time.', submittedBy: 'Liam Foster', submittedDate: '22 Jun 2026', timeAgo: '2 days after' },
  { id: 'fb-06', eventId: 'ev-05', eventTitle: 'AI Tools for Campaign Analytics', clubName: 'AI in Marketing', eventDate: '25 Jun 2026', rating: 5, comment: 'Tom is a wizard with these tools. Built a complete analytics dashboard in 60 minutes — something I had been procrastinating on for weeks. The prompt engineering tips alone were worth it.', submittedBy: 'Emma Lewis', submittedDate: '26 Jun 2026', timeAgo: '1 day after' },
  { id: 'fb-07', eventId: 'ev-07', eventTitle: 'Ethical Decision-Making Workshop', clubName: 'British Values & Professional Practice', eventDate: '29 Jun 2026', rating: 4, comment: 'The case studies were very relevant to real workplace situations. David created a safe space for difficult conversations. Would love more legal sector examples next time.', submittedBy: 'Ryan O\'Connor', submittedDate: '30 Jun 2026', timeAgo: '1 day after' },
  { id: 'fb-08', eventId: 'ev-09', eventTitle: 'Networking Brunch: Meet Your Cohort', clubName: 'Career Growth Club', eventDate: '10 Jun 2026', rating: 5, comment: 'Finally met people face to face! The structured networking format (speed-networking style) meant I actually talked to 15 different apprentices. Left with 8 LinkedIn connections and a study buddy.', submittedBy: 'Fatima Hassan', submittedDate: '11 Jun 2026', timeAgo: '1 day after' },
];

export function getFeedbackByEventId(eventId: string): EventFeedback[] {
  return EVENT_FEEDBACKS.filter((f) => f.eventId === eventId);
}

export function getAverageRating(eventId: string): number {
  const feedback = getFeedbackByEventId(eventId);
  if (feedback.length === 0) return 0;
  return Math.round((feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length) * 10) / 10;
}