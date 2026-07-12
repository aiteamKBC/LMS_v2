<<<<<<< HEAD
import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { ListSkeleton } from '@/components/feature/CurriculumSkeletons';
import { useCurriculumKsbFrameworks } from '@/hooks/useCurriculumKsbFrameworks';
import { useCurriculumKsbSets } from '@/hooks/useCurriculumKsbSets';
import { curriculumNavItems } from '@/mocks/navigation';
import type { CurriculumKsbEntry, CurriculumKsbFramework, CurriculumKsbSet } from '@/lib/curriculumApi';

type KsbGroupKey = 'Knowledge' | 'Skill' | 'Behaviour';

const groupConfig: Record<KsbGroupKey, { label: string; typeCode: string; bg: string; text: string; icon: string }> = {
  Knowledge: { label: 'Knowledge', typeCode: 'K', bg: 'bg-primary-100', text: 'text-primary-700', icon: 'ri-book-open-line' },
  Skill: { label: 'Skills', typeCode: 'S', bg: 'bg-accent-100', text: 'text-accent-700', icon: 'ri-tools-line' },
  Behaviour: { label: 'Behaviours', typeCode: 'B', bg: 'bg-secondary-100', text: 'text-secondary-700', icon: 'ri-user-heart-line' },
};

function cleanCode(value: string, typeCode?: string) {
  let code = String(value || '').trim().toUpperCase();
  if (typeCode && code.startsWith(typeCode)) code = code.slice(1);
  return code.replace(/[^0-9.]/g, '');
}

function typeCodeFor(ksb: CurriculumKsbEntry) {
  if (ksb.fullCode) return ksb.fullCode.charAt(0).toUpperCase();
  if (/^[KSB]/i.test(ksb.code)) return ksb.code.charAt(0).toUpperCase();
  return ksb.type === 'Skill' ? 'S' : ksb.type === 'Behaviour' ? 'B' : 'K';
}

function fullCodeFor(ksb: CurriculumKsbEntry) {
  const typeCode = typeCodeFor(ksb);
  return ksb.fullCode || `${typeCode}${cleanCode(ksb.rawCode || ksb.code, typeCode)}`;
}

function rawCodeFor(ksb: CurriculumKsbEntry) {
  return cleanCode(ksb.rawCode || ksb.code || ksb.fullCode || '', typeCodeFor(ksb));
}

function parentCodeFor(ksb: CurriculumKsbEntry) {
  return cleanCode(ksb.parentCode || '', typeCodeFor(ksb));
}

function visibleDescriptionFor(ksb: CurriculumKsbEntry) {
  const description = String(ksb.description || '').trim();
  const title = String(ksb.title || '').trim();
  if (!description) return '';
  if (description.toLowerCase() === title.toLowerCase()) return '';
  return description;
}

function statusHelpText(status: CurriculumKsbEntry['status']) {
  if (status === 'mapped') return 'This KSB is linked to at least one curriculum module or session.';
  if (status === 'unmapped') return 'This KSB is not linked to any curriculum module or session yet.';
  return 'This KSB is partially linked in the curriculum plan.';
}

function codeSortValue(code: string) {
  return cleanCode(code).split('.').reduce((total, part, index) => total + (Number(part) || 0) / Math.pow(100, index), 0);
}

function findFrameworkSet(framework: CurriculumKsbFramework | undefined, ksbSets: CurriculumKsbSet[]) {
  if (!framework) return undefined;
  return ksbSets.find(set =>
    set.frameworkId === framework.id ||
    String(set.profileId || '') === String(framework.profileId || '').replace(/^ksb-/, '') ||
    set.programmeName === (framework.programmeName || framework.ifateRef) ||
    set.standard === framework.standard
  );
}

function getFilteredKsbs(ksbs: CurriculumKsbEntry[], search: string, typeFilter: string, statusFilter: string) {
  const needle = search.trim().toLowerCase();
  return ksbs.filter(ksb => {
    const fullCode = fullCodeFor(ksb).toLowerCase();
    const haystack = `${fullCode} ${ksb.title} ${ksb.description}`.toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (typeFilter !== 'all' && ksb.type !== typeFilter) return false;
    if (statusFilter !== 'all' && ksb.status !== statusFilter) return false;
    return true;
  });
}

function groupKsbs(ksbs: CurriculumKsbEntry[]) {
  const grouped: Record<KsbGroupKey, CurriculumKsbEntry[]> = { Knowledge: [], Skill: [], Behaviour: [] };
  ksbs.forEach(ksb => grouped[ksb.type]?.push(ksb));
  (Object.keys(grouped) as KsbGroupKey[]).forEach(type => {
    grouped[type].sort((a, b) => codeSortValue(rawCodeFor(a)) - codeSortValue(rawCodeFor(b)));
  });
  return grouped;
}

export default function KSBMapping() {
  const { frameworks, loading: frameworksLoading, error: frameworksError } = useCurriculumKsbFrameworks();
  const { ksbSets, loading: setsLoading, error: setsError } = useCurriculumKsbSets();
  const [selectedFrameworkId, setSelectedFrameworkId] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const activeFrameworks = useMemo(() => frameworks.filter(framework => framework.status !== 'archived'), [frameworks]);
  const selectedFramework = useMemo(
    () => frameworks.find(framework => framework.id === selectedFrameworkId),
    [frameworks, selectedFrameworkId],
  );
  const selectedSet = useMemo(() => findFrameworkSet(selectedFramework, ksbSets), [selectedFramework, ksbSets]);
  const ksbs = useMemo(() => selectedSet?.ksbs ?? [], [selectedSet]);
  const filtered = useMemo(() => getFilteredKsbs(ksbs, search, typeFilter, statusFilter), [ksbs, search, typeFilter, statusFilter]);
  const grouped = useMemo(() => groupKsbs(filtered), [filtered]);
  const loading = frameworksLoading || setsLoading;
  const error = frameworksError || setsError;

  useEffect(() => {
    if (!selectedFrameworkId && activeFrameworks.length > 0) {
      setSelectedFrameworkId(activeFrameworks[0].id);
    }
  }, [activeFrameworks, selectedFrameworkId]);

  const mappedCount = ksbs.filter(ksb => ksb.status === 'mapped').length;
=======
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ActivityType = 'Live Session' | 'Workshop' | 'Self-study' | 'Assignment' | 'Quiz' | 'OTJH' | 'Collaboration' | 'Review';

interface KSBWeight {
  activityType: ActivityType;
  weight: number;
}

interface KSBEntry {
  id: string;
  code: string;
  title: string;
  description: string;
  type: 'Knowledge' | 'Skill' | 'Behaviour';
  standard: string;
  activities: KSBWeight[];
  modules: string[];
  assessmentMethod: string;
  mappedBy: string;
  status: 'mapped' | 'partial' | 'unmapped';
  lastUpdated: string;
}

interface ProgrammeKSBSet {
  programmeId: string;
  programmeName: string;
  standard: string;
  ksbs: KSBEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity type colour & icon map
// ─────────────────────────────────────────────────────────────────────────────

const activityMeta: Record<ActivityType, { color: string; barClass: string; icon: string }> = {
  'Live Session': { color: 'text-primary-700', barClass: 'bg-primary-500', icon: 'ri-presentation-line' },
  'Workshop': { color: 'text-accent-700', barClass: 'bg-accent-500', icon: 'ri-tools-line' },
  'Self-study': { color: 'text-secondary-700', barClass: 'bg-secondary-500', icon: 'ri-book-open-line' },
  'Assignment': { color: 'text-amber-700', barClass: 'bg-amber-500', icon: 'ri-edit-line' },
  'Quiz': { color: 'text-rose-700', barClass: 'bg-rose-500', icon: 'ri-questionnaire-line' },
  'OTJH': { color: 'text-emerald-700', barClass: 'bg-emerald-500', icon: 'ri-time-line' },
  'Collaboration': { color: 'text-violet-700', barClass: 'bg-violet-500', icon: 'ri-team-line' },
  'Review': { color: 'text-sky-700', barClass: 'bg-sky-500', icon: 'ri-file-search-line' },
};

const ALL_ACTIVITY_TYPES: ActivityType[] = [
  'Live Session', 'Workshop', 'Self-study', 'Assignment', 'Quiz', 'OTJH', 'Collaboration', 'Review',
];

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data — Multiple Programmes with full KSB detail
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAMME_KSB_SETS: ProgrammeKSBSet[] = [
  {
    programmeId: 'p-3',
    programmeName: 'Marketing Executive L4',
    standard: 'ST0094',
    ksbs: [
      {
        id: 'k1', code: 'K1', title: 'Marketing concepts and principles', type: 'Knowledge', standard: 'ST0094',
        description: 'The marketing concept, the marketing mix, and how marketing contributes to organisational strategy and objectives. Understanding of the 7Ps framework and its application in B2B and B2C contexts. Learners must demonstrate the ability to apply marketing principles to real business scenarios and evaluate their effectiveness.',
        activities: [
          { activityType: 'Live Session', weight: 15 }, { activityType: 'Workshop', weight: 25 },
          { activityType: 'Self-study', weight: 25 }, { activityType: 'Assignment', weight: 20 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 5 },
          { activityType: 'Collaboration', weight: 0 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 1: Marketing Foundations'], assessmentMethod: 'Professional Discussion + Knowledge Test',
        mappedBy: 'Crispin Jones', status: 'mapped', lastUpdated: '1 Jun 2026',
      },
      {
        id: 'k2', code: 'K2', title: 'Market research and customer insight', type: 'Knowledge', standard: 'ST0094',
        description: 'The role of market research in marketing decision-making. Primary and secondary research methods, both qualitative and quantitative. How to identify, access and interpret marketing data sources to generate actionable customer insight that drives campaign strategy and tactical execution.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 20 }, { activityType: 'Assignment', weight: 30 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 10 },
          { activityType: 'Collaboration', weight: 0 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 2: Customer Insight'], assessmentMethod: 'Professional Discussion + Portfolio',
        mappedBy: 'Crispin Jones', status: 'mapped', lastUpdated: '28 May 2026',
      },
      {
        id: 'k3', code: 'K3', title: 'Customer segmentation and targeting', type: 'Knowledge', standard: 'ST0094',
        description: 'Segmentation bases (demographic, geographic, psychographic, behavioural), targeting strategies (undifferentiated, differentiated, concentrated, micro-marketing), and positioning frameworks. How to profile and select target segments aligned to organisational capability and market opportunity.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 25 },
          { activityType: 'Self-study', weight: 15 }, { activityType: 'Assignment', weight: 30 },
          { activityType: 'Quiz', weight: 15 }, { activityType: 'OTJH', weight: 5 },
          { activityType: 'Collaboration', weight: 0 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 2: Customer Insight'], assessmentMethod: 'Knowledge Test',
        mappedBy: 'Crispin Jones', status: 'mapped', lastUpdated: '25 May 2026',
      },
      {
        id: 'k4', code: 'K4', title: 'Marketing planning and campaign development', type: 'Knowledge', standard: 'ST0094',
        description: 'The marketing planning process including situation analysis, objective setting, strategy development, tactical planning and control. Campaign lifecycle management from brief through to post-campaign review, including resource allocation and risk management.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 30 },
          { activityType: 'Self-study', weight: 15 }, { activityType: 'Assignment', weight: 25 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 5 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 3: Campaign Planning'], assessmentMethod: 'Professional Discussion + Portfolio',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '3 Jun 2026',
      },
      {
        id: 'k5', code: 'K5', title: 'Digital marketing channels and tools', type: 'Knowledge', standard: 'ST0094',
        description: 'The range of digital marketing channels including SEO, PPC, social media, email, content marketing and affiliate marketing. How to select appropriate channels based on campaign objectives, audience and budget. Understanding of marketing automation and CRM platforms for campaign execution.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 25 },
          { activityType: 'Self-study', weight: 20 }, { activityType: 'Assignment', weight: 20 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 10 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 3: Campaign Planning'], assessmentMethod: 'Portfolio + Presentation',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '5 Jun 2026',
      },
      {
        id: 'k6', code: 'K6', title: 'Brand management and positioning', type: 'Knowledge', standard: 'ST0094',
        description: 'Brand architecture, brand equity models, positioning strategies and brand identity systems. How to maintain brand consistency across channels and touchpoints while adapting messaging for different audience segments. Understanding of brand tracking and health metrics.',
        activities: [
          { activityType: 'Live Session', weight: 15 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 25 }, { activityType: 'Assignment', weight: 20 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 5 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 1: Marketing Foundations'], assessmentMethod: 'Knowledge Test + Professional Discussion',
        mappedBy: 'Crispin Jones', status: 'partial', lastUpdated: '8 Jun 2026',
      },
      {
        id: 's1', code: 'S1', title: 'Plan and deliver marketing campaigns', type: 'Skill', standard: 'ST0094',
        description: 'Develop integrated marketing campaign plans that align with organisational objectives. Coordinate campaign execution across channels, manage timelines and resources, and adapt plans based on performance data and stakeholder feedback. Demonstrate end-to-end campaign ownership.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 25 },
          { activityType: 'Self-study', weight: 10 }, { activityType: 'Assignment', weight: 30 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 5 },
        ],
        modules: ['Module 3: Campaign Planning', 'Module 4: Evaluation & EPA'], assessmentMethod: 'Portfolio + Professional Discussion',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '30 May 2026',
      },
      {
        id: 's2', code: 'S2', title: 'Conduct market and customer research', type: 'Skill', standard: 'ST0094',
        description: 'Design and execute primary research (surveys, interviews, focus groups) and secondary research (desk research, data analysis). Synthesise findings into actionable insights and present recommendations to stakeholders using clear, evidence-based communication.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 15 }, { activityType: 'Assignment', weight: 35 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 2: Customer Insight'], assessmentMethod: 'Portfolio',
        mappedBy: 'Crispin Jones', status: 'mapped', lastUpdated: '28 May 2026',
      },
      {
        id: 's3', code: 'S3', title: 'Create marketing content', type: 'Skill', standard: 'ST0094',
        description: 'Produce engaging, on-brand content for multiple channels including social media, web, email and print. Write compelling copy, brief designers and agencies, and adapt tone of voice for different audiences and formats. Maintain content consistency while optimising for channel-specific requirements.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 20 }, { activityType: 'Assignment', weight: 30 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 3: Campaign Planning'], assessmentMethod: 'Portfolio',
        mappedBy: 'Crispin Jones', status: 'partial', lastUpdated: '5 Jun 2026',
      },
      {
        id: 's4', code: 'S4', title: 'Use digital marketing tools and platforms', type: 'Skill', standard: 'ST0094',
        description: 'Operate digital marketing platforms including social media management tools, email marketing systems, CMS platforms, CRM systems and analytics dashboards. Schedule, publish and monitor digital content and campaigns with proficiency in platform-specific features.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 25 },
          { activityType: 'Self-study', weight: 25 }, { activityType: 'Assignment', weight: 20 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Module 3: Campaign Planning'], assessmentMethod: 'Portfolio + Presentation',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '2 Jun 2026',
      },
      {
        id: 's5', code: 'S5', title: 'Analyse marketing data and report performance', type: 'Skill', standard: 'ST0094',
        description: 'Collect, clean and analyse marketing data using tools such as Excel, Google Analytics and social media insights. Create performance reports and dashboards that communicate results, trends and recommendations to stakeholders at all levels with clarity and commercial relevance.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 15 },
          { activityType: 'Self-study', weight: 20 }, { activityType: 'Assignment', weight: 30 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 5 },
        ],
        modules: ['Module 4: Evaluation & EPA'], assessmentMethod: 'Portfolio + Professional Discussion',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '1 Jun 2026',
      },
      {
        id: 'b1', code: 'B1', title: 'Professional and ethical conduct', type: 'Behaviour', standard: 'ST0094',
        description: 'Acts with integrity and honesty, maintaining confidentiality where appropriate. Complies with legal requirements and professional codes of conduct. Takes responsibility for own actions and decisions, demonstrating accountability to colleagues, customers and the organisation.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 10 },
          { activityType: 'Self-study', weight: 10 }, { activityType: 'Assignment', weight: 10 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 20 },
          { activityType: 'Collaboration', weight: 15 }, { activityType: 'Review', weight: 20 },
        ],
        modules: ['All Modules'], assessmentMethod: 'Professional Discussion + Employer Reference',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '2 Jun 2026',
      },
      {
        id: 'b2', code: 'B2', title: 'Proactive and self-motivated', type: 'Behaviour', standard: 'ST0094',
        description: 'Takes initiative to identify opportunities for improvement and acts on them proactively. Manages own workload effectively, prioritising tasks to meet deadlines. Seeks out learning and development opportunities to continuously enhance own knowledge and skills.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 10 },
          { activityType: 'Self-study', weight: 25 }, { activityType: 'Assignment', weight: 15 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 20 },
          { activityType: 'Collaboration', weight: 10 }, { activityType: 'Review', weight: 10 },
        ],
        modules: ['All Modules'], assessmentMethod: 'Professional Discussion',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '1 Jun 2026',
      },
      {
        id: 'b3', code: 'B3', title: 'Collaborative and inclusive', type: 'Behaviour', standard: 'ST0094',
        description: 'Works effectively as part of a team, contributing ideas and supporting colleagues to achieve shared goals. Values diversity and demonstrates inclusive behaviour in all interactions. Builds positive relationships across the organisation and with external partners.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 15 },
          { activityType: 'Self-study', weight: 5 }, { activityType: 'Assignment', weight: 10 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 25 }, { activityType: 'Review', weight: 15 },
        ],
        modules: ['All Modules'], assessmentMethod: 'Professional Discussion + Employer Reference',
        mappedBy: 'Rachel Myers', status: 'partial', lastUpdated: '8 Jun 2026',
      },
    ],
  },
  {
    programmeId: 'p-1',
    programmeName: 'Business Administrator L3',
    standard: 'ST0070',
    ksbs: [
      {
        id: 'ba-k1', code: 'K1', title: 'Business communication principles', type: 'Knowledge', standard: 'ST0070',
        description: 'The principles of effective business communication including written, verbal and digital formats. Understanding of audience analysis, message structuring, and appropriate channel selection. Knowledge of organisational communication policies and professional standards.',
        activities: [
          { activityType: 'Live Session', weight: 15 }, { activityType: 'Workshop', weight: 25 },
          { activityType: 'Self-study', weight: 20 }, { activityType: 'Assignment', weight: 25 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 5 },
          { activityType: 'Collaboration', weight: 0 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Business Communication'], assessmentMethod: 'Knowledge Test + Professional Discussion',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '5 Jun 2026',
      },
      {
        id: 'ba-k2', code: 'K2', title: 'Organisational structures and governance', type: 'Knowledge', standard: 'ST0070',
        description: 'Understanding of different organisational structures, governance frameworks and how decision-making processes operate within business environments. Knowledge of the roles and responsibilities within organisational hierarchies.',
        activities: [
          { activityType: 'Live Session', weight: 20 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 25 }, { activityType: 'Assignment', weight: 20 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 5 },
          { activityType: 'Collaboration', weight: 0 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Organisational Culture'], assessmentMethod: 'Knowledge Test',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '20 May 2026',
      },
      {
        id: 'ba-s1', code: 'S1', title: 'Manage business documents', type: 'Skill', standard: 'ST0070',
        description: 'Create, format, store and retrieve business documents using appropriate software and systems. Ensure documents meet organisational standards for accuracy, branding and compliance. Manage document version control and distribution effectively.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 15 }, { activityType: 'Assignment', weight: 35 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Business Communication', 'Organisational Culture'], assessmentMethod: 'Portfolio',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '2 Jun 2026',
      },
      {
        id: 'ba-s2', code: 'S2', title: 'Coordinate meetings and events', type: 'Skill', standard: 'ST0070',
        description: 'Plan, schedule and coordinate business meetings and events including agenda preparation, venue booking, attendee management and minute-taking. Manage logistics and follow-up actions to ensure meeting outcomes are achieved.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 15 },
          { activityType: 'Self-study', weight: 10 }, { activityType: 'Assignment', weight: 30 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 20 },
          { activityType: 'Collaboration', weight: 10 }, { activityType: 'Review', weight: 5 },
        ],
        modules: ['Business Communication'], assessmentMethod: 'Portfolio + Professional Discussion',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '28 May 2026',
      },
    ],
  },
  {
    programmeId: 'p-2',
    programmeName: 'Software Developer L4',
    standard: 'ST0120',
    ksbs: [
      {
        id: 'sd-k1', code: 'K1', title: 'Software development lifecycle', type: 'Knowledge', standard: 'ST0120',
        description: 'The stages of the software development lifecycle (SDLC) including requirements analysis, design, implementation, testing, deployment and maintenance. Understanding of both traditional waterfall and agile methodologies including Scrum and Kanban.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 20 }, { activityType: 'Assignment', weight: 25 },
          { activityType: 'Quiz', weight: 15 }, { activityType: 'OTJH', weight: 10 },
          { activityType: 'Collaboration', weight: 0 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Agile Development', 'Software Architecture'], assessmentMethod: 'Knowledge Test + Professional Discussion',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '20 May 2026',
      },
      {
        id: 'sd-k2', code: 'K2', title: 'Software design patterns and principles', type: 'Knowledge', standard: 'ST0120',
        description: 'Common software design patterns (Singleton, Factory, Observer, Strategy, MVC), SOLID principles, and architectural patterns. Understanding of when and how to apply design patterns to solve recurring software design problems effectively.',
        activities: [
          { activityType: 'Live Session', weight: 10 }, { activityType: 'Workshop', weight: 30 },
          { activityType: 'Self-study', weight: 20 }, { activityType: 'Assignment', weight: 25 },
          { activityType: 'Quiz', weight: 10 }, { activityType: 'OTJH', weight: 5 },
          { activityType: 'Collaboration', weight: 0 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Software Architecture'], assessmentMethod: 'Knowledge Test + Portfolio',
        mappedBy: 'Rachel Myers', status: 'partial', lastUpdated: '22 May 2026',
      },
      {
        id: 'sd-s1', code: 'S1', title: 'Write clean, maintainable code', type: 'Skill', standard: 'ST0120',
        description: 'Write well-structured, readable and maintainable code following industry best practices and coding standards. Apply appropriate naming conventions, commenting practices, and code organisation principles. Use version control systems effectively.',
        activities: [
          { activityType: 'Live Session', weight: 5 }, { activityType: 'Workshop', weight: 20 },
          { activityType: 'Self-study', weight: 15 }, { activityType: 'Assignment', weight: 35 },
          { activityType: 'Quiz', weight: 5 }, { activityType: 'OTJH', weight: 15 },
          { activityType: 'Collaboration', weight: 5 }, { activityType: 'Review', weight: 0 },
        ],
        modules: ['Agile Development', 'Software Architecture'], assessmentMethod: 'Portfolio + Professional Discussion',
        mappedBy: 'Rachel Myers', status: 'mapped', lastUpdated: '25 May 2026',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function KSBMapping() {
  const [selectedProgramme, setSelectedProgramme] = useState(PROGRAMME_KSB_SETS[0].programmeId);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedKsb, setExpandedKsb] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'detail' | 'matrix'>('detail');

  const programme = PROGRAMME_KSB_SETS.find(p => p.programmeId === selectedProgramme) || PROGRAMME_KSB_SETS[0];

  const filtered = programme.ksbs.filter(k => {
    if (search && !k.title.toLowerCase().includes(search.toLowerCase()) && !k.code.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && k.type !== typeFilter) return false;
    if (statusFilter !== 'all' && k.status !== statusFilter) return false;
    return true;
  });

  const mappedCount = programme.ksbs.filter(k => k.status === 'mapped').length;
  const partialCount = programme.ksbs.filter(k => k.status === 'partial').length;
  const unmappedCount = programme.ksbs.filter(k => k.status === 'unmapped').length;

  const ksbTypeColors: Record<string, { bg: string; text: string; bar: string }> = {
    Knowledge: { bg: 'bg-primary-50', text: 'text-primary-700', bar: 'bg-primary-500' },
    Skill: { bg: 'bg-accent-50', text: 'text-accent-700', bar: 'bg-accent-500' },
    Behaviour: { bg: 'bg-secondary-50', text: 'text-secondary-700', bar: 'bg-secondary-500' },
  };

  const statusColors: Record<string, string> = {
    mapped: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-amber-100 text-amber-700',
    unmapped: 'bg-red-100 text-red-700',
  };

  // Matrix: compute total weight per KSB
  const getTotalWeight = (ksb: KSBEntry) => ksb.activities.reduce((s, a) => s + a.weight, 0);
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="KSB Mapping"
<<<<<<< HEAD
      pageSubtitle="View and map KSB statements from curriculum frameworks."
=======
      pageSubtitle={`${programme.ksbs.length} KSBs · ${mappedCount} mapped · ${partialCount} partial · Standard: ${programme.standard}`}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="p-6 space-y-6">
<<<<<<< HEAD
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
=======
        {/* ── Hero Banner ── */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-link text-white text-2xl"></i>
            </span>
            <div className="flex-1">
<<<<<<< HEAD
              <h2 className="text-lg font-heading font-bold text-white mb-1">KSB Mapping</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                {selectedFramework ? `${selectedFramework.name} · ${ksbs.length} KSB definitions · ${mappedCount} mapped` : 'Select a KSB framework to inspect its Knowledge, Skills and Behaviours.'}
              </p>
            </div>
            <button onClick={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-frameworks')} className="px-4 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-[12px] font-semibold hover:bg-white/30 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-settings-3-line mr-1"></i> Manage Frameworks
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}

        <div className="rounded-xl border border-background-200 bg-background-50 p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-end gap-3">
            <label className="w-full lg:w-[360px]">
              <span className="block text-[11px] font-semibold text-foreground-400 uppercase mb-1">KSB Framework</span>
              <select
                value={selectedFrameworkId}
                onChange={event => setSelectedFrameworkId(event.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer font-medium"
              >
                <option value="">Select a KSB framework...</option>
                {activeFrameworks.map(framework => (
                  <option key={framework.id} value={framework.id}>
                    {framework.name} · {framework.programmeName || framework.ifateRef || framework.standard}
                  </option>
                ))}
              </select>
            </label>
            <div className="relative flex-1 w-full">
              <span className="block text-[11px] font-semibold text-foreground-400 uppercase mb-1">Search KSBs</span>
              <i className="ri-search-line absolute left-3 bottom-3 text-foreground-400 text-sm"></i>
              <input type="text" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search code, title or description..." className="w-full pl-9 pr-3 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300" />
            </div>
            <FilterButtons value={typeFilter} onChange={setTypeFilter} items={[['all', 'All Types'], ['Knowledge', 'Knowledge'], ['Skill', 'Skills'], ['Behaviour', 'Behaviours']]} />
            <FilterButtons value={statusFilter} onChange={setStatusFilter} items={[['all', 'All'], ['mapped', 'Mapped'], ['partial', 'Partial'], ['unmapped', 'Unmapped']]} />
          </div>
        </div>

        {loading ? (
          <ListSkeleton count={6} />
        ) : !selectedFrameworkId ? (
          <EmptyState icon="ri-list-check-3" title="Select a KSB framework" message="Select a KSB framework to view its Knowledge, Skills and Behaviours." />
        ) : selectedFramework && ksbs.length === 0 ? (
          <EmptyState icon="ri-inbox-line" title="No KSB definitions" message="This framework has no KSB definitions yet. Add KSBs from the Framework Manager." actionLabel="Open Framework Manager" onAction={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-frameworks')} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="ri-search-line" title="No KSBs match your search" message="No KSBs match your search." />
        ) : (
          <div className="space-y-4">
            {(Object.keys(grouped) as KsbGroupKey[]).map(type => (
              <KsbGroupSection key={type} type={type} items={grouped[type]} />
            ))}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function KsbGroupSection({ type, items }: { type: KsbGroupKey; items: CurriculumKsbEntry[] }) {
  const [open, setOpen] = useState(true);
  const config = groupConfig[type];
  const parents = items.filter(item => !parentCodeFor(item) && !rawCodeFor(item).includes('.'));
  const childrenFor = (parent: CurriculumKsbEntry) => {
    const parentCode = rawCodeFor(parent);
    return items.filter(item => {
      const itemCode = rawCodeFor(item);
      const sameType = typeCodeFor(item) === typeCodeFor(parent);
      const explicitParent = parentCodeFor(item) === parentCode;
      const inferredParent = !parentCodeFor(item) && itemCode.startsWith(`${parentCode}.`);
      return sameType && (explicitParent || inferredParent);
    });
  };

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-background-200 bg-background-50 overflow-hidden">
      <button onClick={() => setOpen(prev => !prev)} className="w-full px-4 py-3 bg-background-100/70 flex items-center gap-3 text-left">
        <span className={`w-9 h-9 rounded-lg ${config.bg} ${config.text} flex items-center justify-center`}>
          <i className={`${config.icon} text-sm`}></i>
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-heading font-bold text-foreground-900">{config.label}</h3>
          <p className="text-[11px] text-foreground-400">{items.length} KSB definitions</p>
        </div>
        <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>
      {open && (
        <div className="p-4 space-y-3">
          {parents.map(parent => (
            <KsbParentCard key={parent.id} parent={parent} children={childrenFor(parent)} />
          ))}
          {parents.length === 0 && items.map(item => <KsbParentCard key={item.id} parent={item} children={[]} />)}
        </div>
      )}
    </section>
  );
}

function KsbParentCard({ parent, children }: { parent: CurriculumKsbEntry; children: CurriculumKsbEntry[] }) {
  const config = groupConfig[parent.type];
  const parentDescription = visibleDescriptionFor(parent);
  return (
    <div className="rounded-xl border border-background-200 bg-white overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <span className={`min-w-12 px-2 h-9 rounded-lg ${config.bg} ${config.text} flex items-center justify-center text-xs font-bold`}>
          {fullCodeFor(parent)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-foreground-900">{parent.title || fullCodeFor(parent)}</h4>
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>{parent.type}</span>
            {parent.status && <StatusBadge status={parent.status} />}
          </div>
          {parentDescription && <p className="mt-1 text-[12px] leading-relaxed text-foreground-500">{parentDescription}</p>}
        </div>
      </div>
      {children.length > 0 && (
        <div className="border-t border-background-100 bg-background-50/60 px-4 py-3">
          <div className="mb-2 ml-16 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-400">
            <span className={`h-1.5 w-1.5 rounded-full ${config.bg}`}></span>
            Points under {fullCodeFor(parent)}
          </div>
          <div className="relative ml-16 space-y-2 pl-8 before:absolute before:left-3 before:top-0 before:bottom-5 before:w-px before:bg-primary-100">
            {children.map(child => {
              const childDescription = visibleDescriptionFor(child);
              return (
                <div key={child.id} className="relative before:absolute before:-left-5 before:top-5 before:h-px before:w-5 before:bg-primary-100">
                  <div className="flex items-start gap-3 rounded-lg bg-white border border-background-100 p-3">
                    <span className={`min-w-14 px-2 h-8 rounded-md ${config.bg} ${config.text} flex items-center justify-center text-[11px] font-bold`}>
                      {fullCodeFor(child)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground-900">{child.title || fullCodeFor(child)}</p>
                      {childDescription && <p className="mt-0.5 text-[11px] text-foreground-500">{childDescription}</p>}
                    </div>
                    {child.status && <StatusBadge status={child.status} />}
=======
              <h2 className="text-lg font-heading font-bold text-white mb-1">KSB Mapping — Activity Weight Distribution</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                Map each KSB across activity types with variable weights. Weights differ by activity type — assignments carry more skill weight, workshops reinforce knowledge.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-emerald-300">{mappedCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Mapped</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-300">{partialCount + unmappedCount}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Needs Work</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Programme Selector + Filters ── */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-foreground-400 uppercase">Programme:</span>
            <select
              value={selectedProgramme}
              onChange={e => setSelectedProgramme(e.target.value)}
              className="px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer font-medium"
            >
              {PROGRAMME_KSB_SETS.map(p => (
                <option key={p.programmeId} value={p.programmeId}>{p.programmeName} ({p.standard})</option>
              ))}
            </select>
          </div>
          <div className="h-5 w-px bg-background-200 hidden lg:block"></div>
          <div className="relative flex-1 sm:max-w-xs">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search KSBs by code or title..."
              className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300"
            />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All Types' }, { key: 'Knowledge', label: 'Knowledge' }, { key: 'Skill', label: 'Skills' }, { key: 'Behaviour', label: 'Behaviours' }].map(f => (
              <button
                key={f.key}
                onClick={() => setTypeFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${typeFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
              >{f.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' }, { key: 'mapped', label: 'Mapped' }, { key: 'partial', label: 'Partial' }, { key: 'unmapped', label: 'Unmapped' }].map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
              >{f.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 ml-auto">
            {[
              { key: 'detail' as const, label: 'Detail', icon: 'ri-list-check-2' },
              { key: 'matrix' as const, label: 'Matrix', icon: 'ri-grid-line' },
            ].map(v => (
              <button
                key={v.key}
                onClick={() => setViewMode(v.key)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${viewMode === v.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}
              >
                <i className={`${v.icon} text-[13px]`}></i> {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Detail View ── */}
        {viewMode === 'detail' && (
          <div className="space-y-3">
            {filtered.map(ksb => {
              const colors = ksbTypeColors[ksb.type];
              const isExpanded = expandedKsb === ksb.id;
              const totalW = getTotalWeight(ksb);

              return (
                <div key={ksb.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                  <button
                    onClick={() => setExpandedKsb(isExpanded ? null : ksb.id)}
                    className="w-full flex items-start gap-4 p-4 text-left cursor-pointer hover:bg-background-100/30 transition-smooth"
                  >
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ring-2 ${colors.bg} ${colors.text} ring-background-200`}>
                      <span className="text-xs font-bold">{ksb.code}</span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-[13px] font-semibold text-foreground-900">{ksb.title}</h4>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>{ksb.type}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColors[ksb.status]}`}>{ksb.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-500 mt-1 line-clamp-1">{ksb.description}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-semibold text-foreground-400">Total Weight:</span>
                          <div className="w-12 h-1.5 bg-background-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${totalW}%` }}></div>
                          </div>
                          <span className="text-[10px] font-bold text-foreground-700">{totalW}%</span>
                        </div>
                        <span className="text-[10px] text-foreground-400">{ksb.assessmentMethod}</span>
                        <span className="text-[10px] text-foreground-400">{ksb.modules.join(' · ')}</span>
                      </div>
                    </div>
                    <i className={`ri-arrow-down-s-line text-foreground-400 transition-smooth ${isExpanded ? 'rotate-180' : ''}`}></i>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-background-200/30 pt-3 space-y-4">
                      {/* Full Description */}
                      <div>
                        <p className="text-[10px] font-semibold text-foreground-400 uppercase mb-1">Description</p>
                        <p className="text-[12px] text-foreground-600 leading-relaxed">{ksb.description}</p>
                      </div>

                      {/* Activity Weight Distribution */}
                      <div>
                        <p className="text-[10px] font-semibold text-foreground-400 uppercase mb-3">Activity Weight Distribution</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {ksb.activities.filter(a => a.weight > 0).map(act => (
                            <div key={act.activityType} className="bg-background-100 rounded-lg p-3">
                              <div className="flex items-center gap-1.5 mb-2">
                                <i className={`${activityMeta[act.activityType].icon} ${activityMeta[act.activityType].color} text-xs`}></i>
                                <span className="text-[10px] font-medium text-foreground-600">{act.activityType}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-background-200 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${activityMeta[act.activityType].barClass}`} style={{ width: `${act.weight}%` }}></div>
                                </div>
                                <span className="text-[12px] font-bold text-foreground-800">{act.weight}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Meta Info */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-background-100 rounded-lg p-2.5">
                          <p className="text-[9px] text-foreground-400 uppercase">Modules</p>
                          <p className="text-[11px] font-medium text-foreground-700">{ksb.modules.join(', ')}</p>
                        </div>
                        <div className="bg-background-100 rounded-lg p-2.5">
                          <p className="text-[9px] text-foreground-400 uppercase">Assessment</p>
                          <p className="text-[11px] font-medium text-foreground-700">{ksb.assessmentMethod}</p>
                        </div>
                        <div className="bg-background-100 rounded-lg p-2.5">
                          <p className="text-[9px] text-foreground-400 uppercase">Mapped By</p>
                          <p className="text-[11px] font-medium text-foreground-700">{ksb.mappedBy}</p>
                        </div>
                        <div className="bg-background-100 rounded-lg p-2.5">
                          <p className="text-[9px] text-foreground-400 uppercase">Last Updated</p>
                          <p className="text-[11px] font-medium text-foreground-700">{ksb.lastUpdated}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Matrix View ── */}
        {viewMode === 'matrix' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-foreground-400/50 bg-background-100/50">
                    <th className="text-left py-2.5 px-3 font-semibold text-foreground-400 whitespace-nowrap sticky left-0 bg-background-100/50 z-10">KSB</th>
                    <th className="text-left py-2.5 px-3 font-semibold text-foreground-400 whitespace-nowrap">Title</th>
                    <th className="text-center py-2.5 px-2 font-semibold text-foreground-400 whitespace-nowrap">Type</th>
                    {ALL_ACTIVITY_TYPES.map(at => (
                      <th key={at} className="text-center py-2.5 px-2 font-semibold text-foreground-400 whitespace-nowrap">
                        <div className="flex flex-col items-center gap-0.5">
                          <i className={`${activityMeta[at].icon} text-[13px] ${activityMeta[at].color}`}></i>
                          <span className="text-[9px]">{at.split(' ')[0]}</span>
                        </div>
                      </th>
                    ))}
                    <th className="text-center py-2.5 px-3 font-semibold text-foreground-400 whitespace-nowrap">Total</th>
                    <th className="text-center py-2.5 px-3 font-semibold text-foreground-400 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-background-200/30">
                  {filtered.map(ksb => {
                    const colors = ksbTypeColors[ksb.type];
                    const totalW = getTotalWeight(ksb);
                    return (
                      <tr key={ksb.id} className="hover:bg-background-100/30 transition-smooth">
                        <td className="py-2.5 px-3 font-bold text-foreground-700 whitespace-nowrap sticky left-0 bg-background-50">
                          <span className={`inline-flex items-center gap-1 ${colors.text}`}>{ksb.code}</span>
                        </td>
                        <td className="py-2.5 px-3 max-w-[180px]">
                          <p className="text-[11px] font-medium text-foreground-900 truncate">{ksb.title}</p>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>{ksb.type.charAt(0)}</span>
                        </td>
                        {ALL_ACTIVITY_TYPES.map(at => {
                          const act = ksb.activities.find(a => a.activityType === at);
                          const w = act?.weight || 0;
                          return (
                            <td key={at} className="py-2.5 px-2 text-center">
                              {w > 0 ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <div className="w-8 h-1.5 bg-background-200 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${activityMeta[at].barClass}`} style={{ width: `${w}%` }}></div>
                                  </div>
                                  <span className="text-[9px] font-semibold text-foreground-600">{w}</span>
                                </div>
                              ) : (
                                <span className="text-[9px] text-foreground-300">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 text-center">
                          <div className="flex items-center gap-1.5 justify-center">
                            <div className="w-10 h-2 bg-background-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${totalW}%` }}></div>
                            </div>
                            <span className="text-[10px] font-bold text-foreground-700">{totalW}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${statusColors[ksb.status]}`}>{ksb.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── KSB Type Summary ── */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">KSB Type Summary — {programme.programmeName}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(['Knowledge', 'Skill', 'Behaviour'] as const).map(type => {
              const items = programme.ksbs.filter(k => k.type === type);
              const mapped = items.filter(k => k.status === 'mapped').length;
              const colors = ksbTypeColors[type];
              const avgWeight = items.length > 0 ? Math.round(items.reduce((s, k) => s + getTotalWeight(k), 0) / items.length) : 0;
              return (
                <div key={type} className="bg-background-100 rounded-xl border border-foreground-200/60 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${colors.bar}`}></span>
                      <p className="text-[13px] font-semibold text-foreground-800">{type}s</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(k => (
                      <div key={k.id} className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-foreground-400 w-7">{k.code}</span>
                        <div className="flex-1 h-1 bg-background-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${getTotalWeight(k)}%` }}></div>
                        </div>
                        <span className="text-[10px] font-semibold text-foreground-500 w-5 text-right">{getTotalWeight(k)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-foreground-200/60">
                    <span className="text-[10px] text-foreground-400">{mapped}/{items.length} mapped</span>
                    <span className="text-[11px] font-semibold text-foreground-600">Avg weight: {avgWeight}%</span>
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
<<<<<<< HEAD
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CurriculumKsbEntry['status'] }) {
  return (
    <span className="group relative inline-flex">
      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${status === 'mapped' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
        {status}
      </span>
      <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-64 rounded-lg bg-primary-950 px-3 py-2 text-left text-[11px] font-medium leading-snug text-white shadow-lg group-hover:block group-focus-within:block">
        {statusHelpText(status)}
        <span className="absolute -bottom-1 right-4 h-2 w-2 rotate-45 bg-primary-950"></span>
      </span>
    </span>
  );
}

function FilterButtons({ value, onChange, items }: { value: string; onChange: (value: string) => void; items: string[][] }) {
  return (
    <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
      {items.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)} className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${value === key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{label}</button>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, message, actionLabel, onAction }: { icon: string; title: string; message: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="rounded-xl border border-background-200 bg-background-50 px-6 py-14 text-center">
      <i className={`${icon} text-3xl text-foreground-300`}></i>
      <h3 className="mt-3 text-sm font-heading font-bold text-foreground-800">{title}</h3>
      <p className="mt-1 text-sm text-foreground-500">{message}</p>
      {actionLabel && onAction && (
        <button onClick={onAction} className="mt-4 px-4 py-2 rounded-lg bg-primary-950 text-white text-xs font-bold hover:bg-primary-900">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
=======
      </div>
    </WorkspaceShell>
  );
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
