import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface KSBCategory {
  code: string;
  title: string;
  description: string;
  weight: number;
  assessmentMethod: string;
  otjhContribution: number;
}

interface StandardDetail {
  id: string;
  code: string;
  name: string;
  level: string;
  duration: string;
  maxFunding: string;
  status: 'active' | 'in-development' | 'retired';
  version: string;
  approvedDate: string;
  lastReviewed: string;
  route: string;
  epaOrganisation: string;
  occupationalSummary: string;
  typicalJobTitles: string[];
  knowledge: KSBCategory[];
  skills: KSBCategory[];
  behaviours: KSBCategory[];
  programmes: { id: string; name: string; status: string; cohorts: number; learners: number }[];
  dutyAreas: { id: string; title: string; ksbs: string[]; weight: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data — Marketing Executive ST0094
// ─────────────────────────────────────────────────────────────────────────────

const ALL_STANDARDS: Record<string, StandardDetail> = {
  'st0094': {
    id: 'st0094',
    code: 'ST0094',
    name: 'Marketing Executive',
    level: 'Level 4',
    duration: '18 months (typical)',
    maxFunding: '£9,000',
    status: 'active',
    version: '1.2',
    approvedDate: '15 March 2022',
    lastReviewed: 'February 2026',
    route: 'Sales, Marketing and Procurement',
    epaOrganisation: 'Chartered Institute of Marketing (CIM)',
    occupationalSummary: 'Marketing Executives are responsible for planning, developing and implementing marketing campaigns to support the achievement of organisational objectives. They work across a range of channels including digital and social media, contribute to customer insight and market research, and evaluate marketing performance using data and analytics. They work collaboratively with colleagues across the organisation and with external agencies and suppliers.',
    typicalJobTitles: ['Marketing Executive', 'Marketing Officer', 'Digital Marketing Executive', 'Campaign Executive', 'Marketing Coordinator', 'Brand Executive', 'Content Marketing Executive', 'Social Media Executive'],
    knowledge: [
      { code: 'K1', title: 'Marketing concepts and principles', description: 'The marketing concept, the marketing mix, and how marketing contributes to organisational strategy and objectives. Understanding of the 7Ps framework and its application in B2B and B2C contexts.', weight: 8, assessmentMethod: 'Professional Discussion + Knowledge Test', otjhContribution: 32 },
      { code: 'K2', title: 'Market research and customer insight', description: 'The role of market research in marketing decision-making. Primary and secondary research methods, both qualitative and quantitative. How to identify, access and interpret marketing data sources to generate actionable customer insight.', weight: 10, assessmentMethod: 'Professional Discussion + Portfolio', otjhContribution: 40 },
      { code: 'K3', title: 'Customer segmentation and targeting', description: 'Segmentation bases (demographic, geographic, psychographic, behavioural), targeting strategies (undifferentiated, differentiated, concentrated, micro-marketing), and positioning frameworks. How to profile and select target segments aligned to organisational capability.', weight: 8, assessmentMethod: 'Knowledge Test', otjhContribution: 32 },
      { code: 'K4', title: 'Marketing planning and campaign development', description: 'The marketing planning process including situation analysis, objective setting, strategy development, tactical planning and control. Campaign lifecycle management from brief through to post-campaign review.', weight: 10, assessmentMethod: 'Professional Discussion + Portfolio', otjhContribution: 40 },
      { code: 'K5', title: 'Digital marketing channels and tools', description: 'The range of digital marketing channels including SEO, PPC, social media, email, content marketing and affiliate marketing. How to select appropriate channels based on campaign objectives, audience and budget. Understanding of marketing automation and CRM platforms.', weight: 10, assessmentMethod: 'Portfolio + Presentation', otjhContribution: 40 },
      { code: 'K6', title: 'Brand management and positioning', description: 'Brand architecture, brand equity models, positioning strategies and brand identity systems. How to maintain brand consistency across channels and touchpoints. Understanding of brand tracking and health metrics.', weight: 8, assessmentMethod: 'Knowledge Test + Professional Discussion', otjhContribution: 32 },
      { code: 'K7', title: 'Marketing metrics and analytics', description: 'Key marketing metrics including ROI, ROMI, CPA, CLV, conversion rates and engagement metrics. How to set KPIs, build dashboards and use analytics tools (Google Analytics, social media analytics, etc.) to measure and report campaign performance.', weight: 8, assessmentMethod: 'Portfolio + Professional Discussion', otjhContribution: 32 },
      { code: 'K8', title: 'Legal and ethical marketing practice', description: 'GDPR and data protection legislation, CAP Code and ASA regulations, consumer protection law, intellectual property rights in marketing. Ethical considerations including sustainability, diversity and inclusion, and responsible marketing practice.', weight: 6, assessmentMethod: 'Knowledge Test', otjhContribution: 24 },
      { code: 'K9', title: 'Customer journey and experience', description: 'Customer journey mapping across touchpoints. Understanding of customer experience (CX) principles, moments of truth, and service design thinking. How to identify pain points and opportunities for experience improvement.', weight: 6, assessmentMethod: 'Professional Discussion', otjhContribution: 24 },
      { code: 'K10', title: 'Budgeting and commercial awareness', description: 'Marketing budget planning, allocation and tracking. Understanding of profit and loss, cost centres, and how to demonstrate marketing ROI to stakeholders. Commercial awareness of the sector and competitor landscape.', weight: 6, assessmentMethod: 'Portfolio + Professional Discussion', otjhContribution: 24 },
    ],
    skills: [
      { code: 'S1', title: 'Plan and deliver marketing campaigns', description: 'Develop integrated marketing campaign plans that align with organisational objectives. Coordinate campaign execution across channels, manage timelines and resources, and adapt plans based on performance data and stakeholder feedback.', weight: 10, assessmentMethod: 'Portfolio + Professional Discussion', otjhContribution: 45 },
      { code: 'S2', title: 'Conduct market and customer research', description: 'Design and execute primary research (surveys, interviews, focus groups) and secondary research (desk research, data analysis). Synthesise findings into actionable insights and present recommendations to stakeholders.', weight: 8, assessmentMethod: 'Portfolio', otjhContribution: 36 },
      { code: 'S3', title: 'Create marketing content', description: 'Produce engaging, on-brand content for multiple channels including social media, web, email and print. Write compelling copy, brief designers and agencies, and adapt tone of voice for different audiences and formats.', weight: 8, assessmentMethod: 'Portfolio', otjhContribution: 36 },
      { code: 'S4', title: 'Use digital marketing tools and platforms', description: 'Operate digital marketing platforms including social media management tools, email marketing systems, CMS platforms, CRM systems and analytics dashboards. Schedule, publish and monitor digital content and campaigns.', weight: 8, assessmentMethod: 'Portfolio + Presentation', otjhContribution: 36 },
      { code: 'S5', title: 'Analyse marketing data and report performance', description: 'Collect, clean and analyse marketing data using tools such as Excel, Google Analytics and social media insights. Create performance reports and dashboards that communicate results, trends and recommendations to stakeholders at all levels.', weight: 8, assessmentMethod: 'Portfolio + Professional Discussion', otjhContribution: 36 },
      { code: 'S6', title: 'Manage stakeholder relationships', description: 'Build and maintain effective working relationships with internal stakeholders (sales, product, senior management) and external stakeholders (agencies, suppliers, partners). Present ideas, manage expectations and negotiate effectively.', weight: 6, assessmentMethod: 'Professional Discussion', otjhContribution: 27 },
      { code: 'S7', title: 'Manage marketing projects', description: 'Apply project management techniques to marketing initiatives. Define scope, create project plans, manage risks and issues, track progress against milestones and deliver projects on time and within budget.', weight: 6, assessmentMethod: 'Portfolio + Professional Discussion', otjhContribution: 27 },
      { code: 'S8', title: 'Evaluate and optimise marketing activity', description: 'Use A/B testing, multivariate testing and conversion rate optimisation techniques to improve campaign performance. Apply continuous improvement methodologies to marketing processes and activities.', weight: 6, assessmentMethod: 'Portfolio', otjhContribution: 27 },
    ],
    behaviours: [
      { code: 'B1', title: 'Professional and ethical conduct', description: 'Acts with integrity and honesty, maintaining confidentiality where appropriate. Complies with legal requirements and professional codes of conduct. Takes responsibility for own actions and decisions, demonstrating accountability to colleagues, customers and the organisation.', weight: 8, assessmentMethod: 'Professional Discussion + Employer Reference', otjhContribution: 30 },
      { code: 'B2', title: 'Proactive and self-motivated', description: 'Takes initiative to identify opportunities for improvement and acts on them. Manages own workload effectively, prioritising tasks to meet deadlines. Seeks out learning and development opportunities to enhance own knowledge and skills.', weight: 6, assessmentMethod: 'Professional Discussion', otjhContribution: 22 },
      { code: 'B3', title: 'Collaborative and inclusive', description: 'Works effectively as part of a team, contributing ideas and supporting colleagues. Values diversity and demonstrates inclusive behaviour in all interactions. Builds positive relationships across the organisation and with external partners.', weight: 6, assessmentMethod: 'Professional Discussion + Employer Reference', otjhContribution: 22 },
      { code: 'B4', title: 'Adaptable and resilient', description: 'Responds positively to change and demonstrates flexibility when priorities shift. Maintains composure and effectiveness under pressure. Learns from setbacks and uses feedback constructively to improve performance.', weight: 6, assessmentMethod: 'Professional Discussion', otjhContribution: 22 },
      { code: 'B5', title: 'Customer-focused mindset', description: 'Puts the customer at the heart of decision-making. Seeks to understand customer needs and expectations and strives to meet or exceed them. Uses customer feedback and insight to drive improvements in marketing activity.', weight: 6, assessmentMethod: 'Professional Discussion + Portfolio', otjhContribution: 22 },
      { code: 'B6', title: 'Commercial awareness', description: 'Understands the commercial context in which the organisation operates. Makes decisions that balance customer needs with commercial objectives. Contributes to the financial success of the organisation through effective marketing practice.', weight: 6, assessmentMethod: 'Professional Discussion', otjhContribution: 22 },
      { code: 'B7', title: 'Commitment to continuous improvement', description: 'Actively seeks feedback on own performance and uses it to improve. Keeps up to date with marketing trends, tools and best practice. Reflects on own practice and identifies areas for development.', weight: 6, assessmentMethod: 'Professional Discussion + Portfolio', otjhContribution: 22 },
    ],
    programmes: [
      { id: 'p-3', name: 'Marketing Executive L4', status: 'published', cohorts: 3, learners: 14 },
    ],
    dutyAreas: [
      { id: 'D1', title: 'Plan and deliver marketing campaigns', ksbs: ['K1', 'K4', 'K5', 'S1', 'S7'], weight: 25 },
      { id: 'D2', title: 'Research and insight generation', ksbs: ['K2', 'K3', 'K9', 'S2'], weight: 20 },
      { id: 'D3', title: 'Content and channel management', ksbs: ['K5', 'K6', 'S3', 'S4'], weight: 20 },
      { id: 'D4', title: 'Performance analysis and reporting', ksbs: ['K7', 'K10', 'S5', 'S8'], weight: 20 },
      { id: 'D5', title: 'Professional practice and development', ksbs: ['K8', 'S6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'], weight: 15 },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function IfateStandardPage() {
  const { id } = useParams();
  const standard = ALL_STANDARDS[id || 'st0094'] || ALL_STANDARDS.st0094;
  const [activeTab, setActiveTab] = useState<'overview' | 'knowledge' | 'skills' | 'behaviours' | 'duties' | 'programmes'>('overview');
  const [expandedKsb, setExpandedKsb] = useState<string | null>(null);

  const totalKnowWeight = standard.knowledge.reduce((s, k) => s + k.weight, 0);
  const totalSkillWeight = standard.skills.reduce((s, k) => s + k.weight, 0);
  const totalBehaveWeight = standard.behaviours.reduce((s, k) => s + k.weight, 0);
  const totalWeight = totalKnowWeight + totalSkillWeight + totalBehaveWeight;

  const totalOtjh: Record<string, number> = {
    knowledge: standard.knowledge.reduce((s, k) => s + k.otjhContribution, 0),
    skills: standard.skills.reduce((s, k) => s + k.otjhContribution, 0),
    behaviours: standard.behaviours.reduce((s, k) => s + k.otjhContribution, 0),
  };
  const grandOtjh = totalOtjh.knowledge + totalOtjh.skills + totalOtjh.behaviours;

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: 'ri-file-info-line', count: null },
    { key: 'knowledge' as const, label: 'Knowledge', icon: 'ri-lightbulb-line', count: standard.knowledge.length },
    { key: 'skills' as const, label: 'Skills', icon: 'ri-tools-line', count: standard.skills.length },
    { key: 'behaviours' as const, label: 'Behaviours', icon: 'ri-heart-line', count: standard.behaviours.length },
    { key: 'duties' as const, label: 'Duty Areas', icon: 'ri-layout-grid-line', count: standard.dutyAreas.length },
    { key: 'programmes' as const, label: 'Programmes', icon: 'ri-stack-line', count: standard.programmes.length },
  ];

  const ksbTypeColors: Record<string, { bg: string; text: string; bar: string; icon: string }> = {
    knowledge: { bg: 'bg-primary-50', text: 'text-primary-700', bar: 'bg-primary-500', icon: 'ri-lightbulb-line' },
    skills: { bg: 'bg-accent-50', text: 'text-accent-700', bar: 'bg-accent-500', icon: 'ri-tools-line' },
    behaviours: { bg: 'bg-secondary-50', text: 'text-secondary-700', bar: 'bg-secondary-500', icon: 'ri-heart-line' },
  };

  const renderKsbCard = (ksb: KSBCategory, type: 'knowledge' | 'skills' | 'behaviours') => {
    const colors = ksbTypeColors[type];
    return (
      <div key={ksb.code} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden transition-smooth">
        <button
          onClick={() => setExpandedKsb(expandedKsb === ksb.code ? null : ksb.code)}
          className="w-full flex items-start gap-3 p-4 text-left cursor-pointer hover:bg-background-100/30 transition-smooth"
        >
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${colors.bg} ${colors.text}`}>
            <span className="text-[11px] font-bold">{ksb.code}</span>
          </span>
          <div className="flex-1 min-w-0">
            <h4 className="text-[13px] font-semibold text-foreground-900">{ksb.title}</h4>
            <p className="text-[11px] text-foreground-500 mt-0.5 line-clamp-1">{ksb.description}</p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-[10px] font-semibold text-foreground-400">Weight: {ksb.weight}%</span>
              <span className="text-[10px] text-foreground-400">OTJH: {ksb.otjhContribution}h</span>
              <span className={`text-[10px] font-medium ${colors.text}`}>{ksb.assessmentMethod}</span>
            </div>
          </div>
          <i className={`ri-arrow-down-s-line text-foreground-400 transition-smooth ${expandedKsb === ksb.code ? 'rotate-180' : ''}`}></i>
        </button>
        {expandedKsb === ksb.code && (
          <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
            <p className="text-[12px] text-foreground-600 leading-relaxed mb-3">{ksb.description}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-background-100 rounded-lg p-3">
                <p className="text-[9px] text-foreground-400 uppercase font-semibold mb-1">Assessment Method</p>
                <p className="text-[12px] font-medium text-foreground-800">{ksb.assessmentMethod}</p>
              </div>
              <div className="bg-background-100 rounded-lg p-3">
                <p className="text-[9px] text-foreground-400 uppercase font-semibold mb-1">Curriculum Weight</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-background-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${ksb.weight}%` }}></div>
                  </div>
                  <span className="text-[12px] font-bold text-foreground-800">{ksb.weight}%</span>
                </div>
              </div>
              <div className="bg-background-100 rounded-lg p-3">
                <p className="text-[9px] text-foreground-400 uppercase font-semibold mb-1">OTJH Contribution</p>
                <p className="text-[12px] font-medium text-foreground-800">{ksb.otjhContribution}h planned</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle={`${standard.code} — ${standard.name}`}
      pageSubtitle={`IfATE Apprenticeship Standard · ${standard.level} · v${standard.version} · ${standard.status}`}
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="p-6 space-y-6">
        {/* ── Breadcrumb ── */}
        <div className="flex items-center gap-2 text-[11px] text-foreground-400">
          <Link to="/curriculum/standards" className="hover:text-primary-500 transition-smooth cursor-pointer">Standards</Link>
          <i className="ri-arrow-right-s-line text-[10px]"></i>
          <span className="text-foreground-700 font-medium">{standard.code}</span>
        </div>

        {/* ── Standard Header ── */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
              <span className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <span className="text-white text-xl font-bold">{standard.code}</span>
              </span>
              <div className="flex-1">
                <h2 className="text-xl font-heading font-bold text-white mb-1">{standard.name}</h2>
                <p className="text-[13px] text-white/80 leading-relaxed max-w-2xl">{standard.occupationalSummary}</p>
              </div>
              <span className={`text-[10px] font-semibold px-3 py-1 rounded-full shrink-0 ${standard.status === 'active' ? 'bg-emerald-400/30 text-emerald-100 border border-emerald-300/40' : standard.status === 'in-development' ? 'bg-amber-400/30 text-amber-100 border border-amber-300/40' : 'bg-white/20 text-white/70'}`}>
                {standard.status === 'active' ? 'Active' : standard.status === 'in-development' ? 'In Development' : 'Retired'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Quick Stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { icon: 'ri-bar-chart-line', value: `${standard.knowledge.length + standard.skills.length + standard.behaviours.length}`, label: 'Total KSBs' },
            { icon: 'ri-lightbulb-line', value: standard.knowledge.length.toString(), label: 'Knowledge' },
            { icon: 'ri-tools-line', value: standard.skills.length.toString(), label: 'Skills' },
            { icon: 'ri-heart-line', value: standard.behaviours.length.toString(), label: 'Behaviours' },
            { icon: 'ri-time-line', value: `${grandOtjh}h`, label: 'Total OTJH' },
            { icon: 'ri-money-pound-circle-line', value: standard.maxFunding, label: 'Max Funding' },
            { icon: 'ri-calendar-line', value: standard.duration, label: 'Duration' },
            { icon: 'ri-stack-line', value: standard.programmes.length.toString(), label: 'Programmes' },
          ].map((stat, i) => (
            <div key={i} className="bg-background-50 rounded-xl border border-foreground-200/60 p-3 text-center">
              <i className={`${stat.icon} text-foreground-400 text-sm mb-1 block`}></i>
              <p className="text-sm font-bold text-foreground-900">{stat.value}</p>
              <p className="text-[9px] text-foreground-400 uppercase">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer shrink-0 ${activeTab === t.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
            >
              <i className={`${t.icon} text-[13px]`}></i>
              {t.label}
              {t.count && <span className="text-[9px] bg-foreground-200/50 px-1 rounded-full">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* ══════════ OVERVIEW ══════════ */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Standard Info */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Standard Information</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { l: 'IfATE Code', v: standard.code },
                  { l: 'Version', v: standard.version },
                  { l: 'Level', v: standard.level },
                  { l: 'Status', v: standard.status },
                  { l: 'Route', v: standard.route },
                  { l: 'Approved', v: standard.approvedDate },
                  { l: 'Last Reviewed', v: standard.lastReviewed },
                  { l: 'Max Funding', v: standard.maxFunding },
                  { l: 'Duration', v: standard.duration },
                  { l: 'EPA Organisation', v: standard.epaOrganisation },
                ].map((r, i) => (
                  <div key={i} className="bg-background-100 rounded-lg p-3">
                    <p className="text-[9px] text-foreground-400 uppercase font-semibold mb-0.5">{r.l}</p>
                    <p className="text-[13px] font-medium text-foreground-800">{r.v}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Occupational Summary */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Occupational Summary</h3>
              <p className="text-[13px] text-foreground-600 leading-relaxed">{standard.occupationalSummary}</p>
              <div className="mt-4">
                <p className="text-[11px] font-semibold text-foreground-400 uppercase mb-2">Typical Job Titles</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {standard.typicalJobTitles.map((title, i) => (
                    <span key={i} className="text-[11px] font-medium text-foreground-600 bg-background-100 px-3 py-1.5 rounded-full border border-foreground-200/60">{title}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* KSB Distribution */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">KSB Distribution & Weighting</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {([
                  { type: 'knowledge' as const, label: 'Knowledge', items: standard.knowledge, total: totalKnowWeight, color: 'primary' },
                  { type: 'skills' as const, label: 'Skills', items: standard.skills, total: totalSkillWeight, color: 'accent' },
                  { type: 'behaviours' as const, label: 'Behaviours', items: standard.behaviours, total: totalBehaveWeight, color: 'secondary' },
                ]).map((cat) => (
                  <div key={cat.type} className="bg-background-100 rounded-xl border border-foreground-200/60 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full bg-${cat.color}-500`}></span>
                        <p className="text-[13px] font-semibold text-foreground-800">{cat.label}</p>
                      </div>
                      <span className="text-[11px] font-bold text-foreground-500">{cat.items.length} items</span>
                    </div>
                    <div className="space-y-2 mb-3">
                      {cat.items.slice(0, 5).map(ksb => (
                        <div key={ksb.code} className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-foreground-400 w-6">{ksb.code}</span>
                          <div className="flex-1 h-1.5 bg-background-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full bg-${cat.color}-500`} style={{ width: `${(ksb.weight / cat.total) * 100}%` }}></div>
                          </div>
                          <span className="text-[10px] font-semibold text-foreground-500">{ksb.weight}%</span>
                        </div>
                      ))}
                      {cat.items.length > 5 && (
                        <p className="text-[10px] text-foreground-400 italic pl-6">+ {cat.items.length - 5} more</p>
                      )}
                    </div>
                    <div className="pt-3 border-t border-foreground-200/60">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-foreground-400">Total Weight</span>
                        <span className={`text-sm font-bold text-${cat.color}-600`}>{cat.total}%</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[11px] text-foreground-400">OTJH</span>
                        <span className="text-[12px] font-semibold text-foreground-700">{totalOtjh[cat.type]}h</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Overall bar */}
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-foreground-400">Overall: {totalWeight}%</span>
                  <div className="flex-1 h-2.5 bg-background-200 rounded-full overflow-hidden flex">
                    <div className="h-full bg-primary-500" style={{ width: `${(totalKnowWeight / totalWeight) * 100}%` }}></div>
                    <div className="h-full bg-accent-500" style={{ width: `${(totalSkillWeight / totalWeight) * 100}%` }}></div>
                    <div className="h-full bg-secondary-500" style={{ width: `${(totalBehaveWeight / totalWeight) * 100}%` }}></div>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2">
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-primary-500"></span><span className="text-[10px] text-foreground-400">Knowledge {totalKnowWeight}%</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent-500"></span><span className="text-[10px] text-foreground-400">Skills {totalSkillWeight}%</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-secondary-500"></span><span className="text-[10px] text-foreground-400">Behaviours {totalBehaveWeight}%</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ KNOWLEDGE ══════════ */}
        {activeTab === 'knowledge' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-foreground-500">{standard.knowledge.length} Knowledge statements · Total weight: {totalKnowWeight}% · OTJH: {totalOtjh.knowledge}h</p>
            </div>
            {standard.knowledge.map(ksb => renderKsbCard(ksb, 'knowledge'))}
          </div>
        )}

        {/* ══════════ SKILLS ══════════ */}
        {activeTab === 'skills' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-foreground-500">{standard.skills.length} Skills statements · Total weight: {totalSkillWeight}% · OTJH: {totalOtjh.skills}h</p>
            </div>
            {standard.skills.map(ksb => renderKsbCard(ksb, 'skills'))}
          </div>
        )}

        {/* ══════════ BEHAVIOURS ══════════ */}
        {activeTab === 'behaviours' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-foreground-500">{standard.behaviours.length} Behaviour statements · Total weight: {totalBehaveWeight}% · OTJH: {totalOtjh.behaviours}h</p>
            </div>
            {standard.behaviours.map(ksb => renderKsbCard(ksb, 'behaviours'))}
          </div>
        )}

        {/* ══════════ DUTY AREAS ══════════ */}
        {activeTab === 'duties' && (
          <div className="space-y-4">
            <p className="text-[12px] text-foreground-500">{standard.dutyAreas.length} duty areas defined for this standard</p>
            {standard.dutyAreas.map(duty => (
              <div key={duty.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold">{duty.id}</span>
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground-900">{duty.title}</h4>
                      <p className="text-[11px] text-foreground-400">Weight: {duty.weight}% · {duty.ksbs.length} KSBs</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-2 bg-background-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${duty.weight}%` }}></div>
                    </div>
                    <span className="text-[11px] font-semibold text-primary-600">{duty.weight}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {duty.ksbs.map(k => {
                    const isK = k.startsWith('K');
                    const isS = k.startsWith('S');
                    return (
                      <span key={k} className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${isK ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : isS ? 'bg-accent-50 text-accent-700 border border-accent-200/50' : 'bg-secondary-50 text-secondary-700 border border-secondary-200/50'}`}>
                        {k}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════════ PROGRAMMES ══════════ */}
        {activeTab === 'programmes' && (
          <div className="space-y-4">
            <p className="text-[12px] text-foreground-500">{standard.programmes.length} programme(s) using this standard</p>
            {standard.programmes.map(prog => (
              <Link key={prog.id} to={`/curriculum/programmes/${prog.id}`} className="block bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium hover:border-primary-200/50 transition-smooth cursor-pointer">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-12 h-12 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                      <i className="ri-stack-line text-lg"></i>
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground-900">{prog.name}</h4>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${prog.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{prog.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{prog.cohorts} cohorts · {prog.learners} learners</p>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line text-foreground-400"></i>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}