import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Types — Full Programme Hierarchy
// ─────────────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  title: string;
  type: 'Live Session' | 'Workshop' | 'Self-study' | 'Assignment' | 'Quiz' | 'OTJH' | 'Collaboration' | 'Review';
  day: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  tutor: string;
  venue: string;
  deliveryMode: string;
  ksbRefs: string[];
  status: 'scheduled' | 'completed' | 'cancelled' | 'pending';
}

interface Week {
  id: string;
  number: number;
  title: string;
  startDate: string;
  endDate: string;
  otjh: number;
  sessions: Session[];
}

interface Module {
  id: string;
  name: string;
  description: string;
  weeks: number;
  otjh: number;
  version: string;
  status: 'published' | 'approved' | 'in-review' | 'draft';
  ksbTags: string[];
  ksbMapping: { ksb: string; weight: number }[];
  weeksData: Week[];
}

interface Group {
  id: string;
  name: string;
  learners: number;
  coach: string;
  tutor: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'pending' | 'completed';
  modules: Module[];
  schedule: string;
  mode: string;
}

interface Cohort {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'planned' | 'completed';
  learners: number;
  groups: Group[];
  progress: number;
  attendance: number;
}

interface Programme {
  id: string;
  name: string;
  standard: string;
  level: string;
  status: 'published' | 'approved' | 'in-review' | 'draft';
  description: string;
  duration: string;
  intent: string;
  rationale: string;
  learnerBenefit: string;
  employerBenefit: string;
  epaOverview: string;
  qualifications: string[];
  mainKsbs: string[];
  secondaryKsbs: string[];
  cohorts: Cohort[];
  modules: Module[];
  ksbHeatmap: { ksb: string; title: string; coverage: Record<string, number | null> }[];
  moduleNames: string[];
  staffing: { coach: string; tutor: string; groups: string; cohorts: string; status: string; role: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Data — Marketing Executive Level 4
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAMME: Programme = {
  id: 'p-3',
  name: 'Marketing Executive',
  standard: 'ST0094',
  level: 'Level 4',
  status: 'published',
  description: '16-month L4 apprenticeship preparing learners for the Marketing Executive standard and CIM L4 Diploma.',
  duration: '16 months',
  intent: 'Build a confident, evidence-led marketing executive who can plan, deliver and evaluate campaigns aligned to employer goals.',
  rationale: 'Sequenced foundations → insight → planning/channels → evaluation/EPA so KSBs build cumulatively. Each module reinforces and applies prior KSBs.',
  learnerBenefit: 'Career-ready marketing executive with professional qualification, portfolio and confidence to lead campaigns.',
  employerBenefit: 'Measurable improvements in campaign quality, insight-led decisions and team capability.',
  epaOverview: 'EPA covers: professional discussion underpinned by portfolio, knowledge test, and presentation with questions.',
  qualifications: ['CIM Level 4 Diploma in Professional Marketing'],
  mainKsbs: ['K11', 'K21', 'K22', 'K31', 'K41', 'K51', 'S51', 'S52', 'S61', 'S71'],
  secondaryKsbs: ['S12', 'S11', 'S21', 'S31'],
  moduleNames: ['M1', 'M2', 'M3', 'M4'],

  cohorts: [
    {
      id: 'c-A',
      name: 'Cohort A',
      startDate: 'Sep 2024',
      endDate: 'Mar 2026',
      status: 'active',
      learners: 8,
      progress: 72,
      attendance: 94,
      groups: [
        {
          id: 'g-A1',
          name: 'Group A1',
          learners: 4,
          coach: 'Sarah Mitchell',
          tutor: 'James Thompson',
          startDate: 'Sep 2024',
          endDate: 'Mar 2026',
          status: 'active',
          schedule: 'Mon, Wed, Fri — 09:30',
          mode: 'Blended',
          modules: [],
        },
        {
          id: 'g-A2',
          name: 'Group A2',
          learners: 4,
          coach: 'David Chen',
          tutor: 'Emily Roberts',
          startDate: 'Sep 2024',
          endDate: 'Mar 2026',
          status: 'active',
          schedule: 'Tue, Thu — 13:00',
          mode: 'Remote',
          modules: [],
        },
      ],
    },
    {
      id: 'c-B',
      name: 'Cohort B',
      startDate: 'Mar 2025',
      endDate: 'Sep 2026',
      status: 'active',
      learners: 6,
      progress: 45,
      attendance: 89,
      groups: [
        {
          id: 'g-B1',
          name: 'Group B1',
          learners: 3,
          coach: 'Sarah Mitchell',
          tutor: 'James Thompson',
          startDate: 'Mar 2025',
          endDate: 'Sep 2026',
          status: 'active',
          schedule: 'Mon, Wed — 09:30',
          mode: 'Blended',
          modules: [],
        },
        {
          id: 'g-B2',
          name: 'Group B2',
          learners: 3,
          coach: 'Lisa Park',
          tutor: 'Mark Williams',
          startDate: 'Mar 2025',
          endDate: 'Sep 2026',
          status: 'active',
          schedule: 'Tue, Thu — 09:30',
          mode: 'In-person',
          modules: [],
        },
      ],
    },
    {
      id: 'c-C',
      name: 'Cohort C',
      startDate: 'Sep 2025',
      endDate: 'Mar 2027',
      status: 'planned',
      learners: 0,
      progress: 0,
      attendance: 0,
      groups: [
        {
          id: 'g-C1',
          name: 'Group C1',
          learners: 0,
          coach: 'Unassigned',
          tutor: 'Unassigned',
          startDate: 'Sep 2025',
          endDate: 'Mar 2027',
          status: 'pending',
          schedule: 'TBD',
          mode: 'Blended',
          modules: [],
        },
      ],
    },
  ],

  modules: [
    {
      id: 'mod-1',
      name: 'Module 1 — Marketing Foundations & the Marketing Environment',
      description: 'Establish a shared language and framework for marketing before learners specialise in insight, planning and channels.',
      weeks: 4,
      otjh: 90,
      version: 'v1.2',
      status: 'published',
      ksbTags: ['K11', 'K21', 'S12', 'S11'],
      ksbMapping: [
        { ksb: 'K11', weight: 40 },
        { ksb: 'K21', weight: 25 },
        { ksb: 'S12', weight: 20 },
        { ksb: 'S11', weight: 20 },
      ],
      weeksData: [
        {
          id: 'wk-1',
          number: 1,
          title: 'Introduction to Marketing Foundations',
          startDate: '1 Sep 2024',
          endDate: '7 Sep 2024',
          otjh: 22,
          sessions: [
            { id: 's-1', title: 'Welcome & Cohort Induction', type: 'Live Session', day: 'Mon', date: '1 Sep', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['B1', 'B2'], status: 'completed' },
            { id: 's-2', title: 'Marketing Environment & PESTLE', type: 'Workshop', day: 'Wed', date: '3 Sep', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'James Thompson', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K11', 'K21'], status: 'completed' },
            { id: 's-3', title: 'Self-study: Marketing Frameworks', type: 'Self-study', day: 'Thu', date: '4 Sep', startTime: '14:00', endTime: '15:30', duration: 90, tutor: 'Self-directed', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['K11'], status: 'completed' },
            { id: 's-4', title: 'Weekly OTJH Log & Reflection', type: 'OTJH', day: 'Fri', date: '5 Sep', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
            { id: 's-5', title: 'Quiz — Marketing Foundations', type: 'Quiz', day: 'Fri', date: '5 Sep', startTime: '11:00', endTime: '11:30', duration: 30, tutor: 'Auto-marked', venue: 'LMS', deliveryMode: 'Online', ksbRefs: ['K11', 'K21'], status: 'completed' },
          ],
        },
        {
          id: 'wk-2',
          number: 2,
          title: 'Customer Journey & Market Segmentation',
          startDate: '8 Sep 2024',
          endDate: '14 Sep 2024',
          otjh: 22,
          sessions: [
            { id: 's-6', title: 'Customer Journey Mapping', type: 'Live Session', day: 'Mon', date: '8 Sep', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Emily Roberts', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K22', 'S12'], status: 'completed' },
            { id: 's-7', title: 'Segmentation Workshop', type: 'Workshop', day: 'Wed', date: '10 Sep', startTime: '09:30', endTime: '12:00', duration: 150, tutor: 'Emily Roberts', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K22', 'S12'], status: 'completed' },
            { id: 's-8', title: 'Segmentation Analysis Assignment', type: 'Assignment', day: 'Thu', date: '11 Sep', startTime: '14:00', endTime: '16:00', duration: 120, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['S12', 'S11'], status: 'completed' },
            { id: 's-9', title: 'Weekly Review & OTJH', type: 'OTJH', day: 'Fri', date: '12 Sep', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
        {
          id: 'wk-3',
          number: 3,
          title: 'Brand Positioning & Value Proposition',
          startDate: '15 Sep 2024',
          endDate: '21 Sep 2024',
          otjh: 22,
          sessions: [
            { id: 's-10', title: 'Brand Positioning Principles', type: 'Live Session', day: 'Mon', date: '15 Sep', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K31', 'K41'], status: 'completed' },
            { id: 's-11', title: 'Value Proposition Workshop', type: 'Workshop', day: 'Wed', date: '17 Sep', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'James Thompson', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K31', 'S51'], status: 'completed' },
            { id: 's-12', title: 'Positioning Exercise', type: 'Assignment', day: 'Thu', date: '18 Sep', startTime: '14:00', endTime: '15:30', duration: 90, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['K31', 'S51'], status: 'completed' },
            { id: 's-13', title: 'Peer Review Session', type: 'Collaboration', day: 'Fri', date: '19 Sep', startTime: '10:00', endTime: '11:00', duration: 60, tutor: 'Emily Roberts', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['S51', 'B2'], status: 'completed' },
          ],
        },
        {
          id: 'wk-4',
          number: 4,
          title: 'Module 1 Assessment & Review',
          startDate: '22 Sep 2024',
          endDate: '28 Sep 2024',
          otjh: 24,
          sessions: [
            { id: 's-14', title: 'Assessment Preparation', type: 'Live Session', day: 'Mon', date: '22 Sep', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K11', 'K21', 'K31'], status: 'completed' },
            { id: 's-15', title: 'Module 1 Knowledge Test', type: 'Quiz', day: 'Wed', date: '24 Sep', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Auto-marked', venue: 'LMS', deliveryMode: 'Online', ksbRefs: ['K11', 'K21', 'K22'], status: 'completed' },
            { id: 's-16', title: 'Portfolio Review 1-to-1', type: 'Review', day: 'Thu', date: '25 Sep', startTime: '14:00', endTime: '14:45', duration: 45, tutor: 'Sarah Mitchell', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['B1', 'B2'], status: 'completed' },
            { id: 's-17', title: 'Module 1 Wrap-up & OTJH', type: 'OTJH', day: 'Fri', date: '26 Sep', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
      ],
    },
    {
      id: 'mod-2',
      name: 'Module 2 — Customer Insight, Research and Data',
      description: 'Move learners from basic marketing knowledge into evidence-based decision-making.',
      weeks: 4,
      otjh: 90,
      version: 'v1.0',
      status: 'approved',
      ksbTags: ['K21', 'K22', 'S51', 'S52', 'S61', 'S11'],
      ksbMapping: [
        { ksb: 'K21', weight: 25 },
        { ksb: 'K22', weight: 30 },
        { ksb: 'S51', weight: 25 },
        { ksb: 'S52', weight: 10 },
        { ksb: 'S61', weight: 5 },
        { ksb: 'S11', weight: 5 },
      ],
      weeksData: [
        {
          id: 'wk-5',
          number: 5,
          title: 'Research Methods & Data Collection',
          startDate: '29 Sep 2024',
          endDate: '5 Oct 2024',
          otjh: 22,
          sessions: [
            { id: 's-18', title: 'Qualitative vs Quantitative Research', type: 'Live Session', day: 'Mon', date: '29 Sep', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Mark Williams', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K21', 'K22'], status: 'completed' },
            { id: 's-19', title: 'Survey Design Workshop', type: 'Workshop', day: 'Wed', date: '1 Oct', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'Mark Williams', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K22', 'S52'], status: 'completed' },
            { id: 's-20', title: 'Data Collection Assignment', type: 'Assignment', day: 'Thu', date: '2 Oct', startTime: '14:00', endTime: '16:00', duration: 120, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['K22', 'S52'], status: 'completed' },
            { id: 's-21', title: 'Weekly OTJH Log', type: 'OTJH', day: 'Fri', date: '3 Oct', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
        {
          id: 'wk-6',
          number: 6,
          title: 'Data Analysis & Interpretation',
          startDate: '6 Oct 2024',
          endDate: '12 Oct 2024',
          otjh: 22,
          sessions: [
            { id: 's-22', title: 'Analysing Marketing Data', type: 'Live Session', day: 'Mon', date: '6 Oct', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Mark Williams', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K21', 'S51'], status: 'completed' },
            { id: 's-23', title: 'Data Visualisation Workshop', type: 'Workshop', day: 'Wed', date: '8 Oct', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'Mark Williams', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['S51', 'S52'], status: 'completed' },
            { id: 's-24', title: 'Interpretation Exercise', type: 'Assignment', day: 'Thu', date: '9 Oct', startTime: '14:00', endTime: '15:30', duration: 90, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['S51', 'S61'], status: 'completed' },
            { id: 's-25', title: 'Group Discussion', type: 'Collaboration', day: 'Fri', date: '10 Oct', startTime: '10:00', endTime: '11:00', duration: 60, tutor: 'Emily Roberts', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['S61', 'B2'], status: 'completed' },
          ],
        },
        {
          id: 'wk-7',
          number: 7,
          title: 'Insight Application & Personas',
          startDate: '13 Oct 2024',
          endDate: '19 Oct 2024',
          otjh: 22,
          sessions: [
            { id: 's-26', title: 'Customer Insight & Personas', type: 'Live Session', day: 'Mon', date: '13 Oct', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K22', 'S51'], status: 'completed' },
            { id: 's-27', title: 'Persona Building Workshop', type: 'Workshop', day: 'Wed', date: '15 Oct', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'James Thompson', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K22', 'S52'], status: 'completed' },
            { id: 's-28', title: 'Persona Application', type: 'Assignment', day: 'Thu', date: '16 Oct', startTime: '14:00', endTime: '15:30', duration: 90, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['S52', 'S61'], status: 'completed' },
            { id: 's-29', title: 'Weekly Review', type: 'OTJH', day: 'Fri', date: '17 Oct', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
        {
          id: 'wk-8',
          number: 8,
          title: 'Module 2 Assessment & Review',
          startDate: '20 Oct 2024',
          endDate: '26 Oct 2024',
          otjh: 24,
          sessions: [
            { id: 's-30', title: 'Assessment Prep', type: 'Live Session', day: 'Mon', date: '20 Oct', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Mark Williams', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K21', 'K22'], status: 'completed' },
            { id: 's-31', title: 'Module 2 Knowledge Test', type: 'Quiz', day: 'Wed', date: '22 Oct', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Auto-marked', venue: 'LMS', deliveryMode: 'Online', ksbRefs: ['K21', 'K22', 'S51'], status: 'completed' },
            { id: 's-32', title: 'Portfolio Review', type: 'Review', day: 'Thu', date: '23 Oct', startTime: '14:00', endTime: '14:45', duration: 45, tutor: 'Sarah Mitchell', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['B1'], status: 'completed' },
            { id: 's-33', title: 'Module 2 Wrap-up', type: 'OTJH', day: 'Fri', date: '24 Oct', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
      ],
    },
    {
      id: 'mod-3',
      name: 'Module 3 — Campaign Planning & Digital Channels',
      description: 'Translate insight into executable campaign plans.',
      weeks: 4,
      otjh: 90,
      version: 'v0.6',
      status: 'in-review',
      ksbTags: ['K31', 'K41', 'S51', 'S61', 'S71'],
      ksbMapping: [
        { ksb: 'K31', weight: 25 },
        { ksb: 'K41', weight: 30 },
        { ksb: 'S51', weight: 20 },
        { ksb: 'S61', weight: 20 },
        { ksb: 'S71', weight: 15 },
      ],
      weeksData: [
        {
          id: 'wk-9',
          number: 9,
          title: 'Campaign Planning Framework',
          startDate: '27 Oct 2024',
          endDate: '2 Nov 2024',
          otjh: 22,
          sessions: [
            { id: 's-34', title: 'Campaign Planning Overview', type: 'Live Session', day: 'Mon', date: '27 Oct', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K31', 'K41'], status: 'completed' },
            { id: 's-35', title: 'Campaign Planning Workshop', type: 'Workshop', day: 'Wed', date: '29 Oct', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'James Thompson', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K31', 'S51'], status: 'completed' },
            { id: 's-36', title: 'Campaign Brief Assignment', type: 'Assignment', day: 'Thu', date: '30 Oct', startTime: '14:00', endTime: '16:00', duration: 120, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['K31', 'S51'], status: 'completed' },
            { id: 's-37', title: 'Weekly OTJH', type: 'OTJH', day: 'Fri', date: '31 Oct', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
        {
          id: 'wk-10',
          number: 10,
          title: 'Digital Channels Strategy',
          startDate: '3 Nov 2024',
          endDate: '9 Nov 2024',
          otjh: 22,
          sessions: [
            { id: 's-38', title: 'Digital Channels Overview', type: 'Live Session', day: 'Mon', date: '3 Nov', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Emily Roberts', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K41', 'S61'], status: 'completed' },
            { id: 's-39', title: 'Channel Strategy Workshop', type: 'Workshop', day: 'Wed', date: '5 Nov', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'Emily Roberts', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K41', 'S61'], status: 'completed' },
            { id: 's-40', title: 'Channel Selection Exercise', type: 'Assignment', day: 'Thu', date: '6 Nov', startTime: '14:00', endTime: '15:30', duration: 90, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['S61', 'S71'], status: 'completed' },
            { id: 's-41', title: 'Peer Review', type: 'Collaboration', day: 'Fri', date: '7 Nov', startTime: '10:00', endTime: '11:00', duration: 60, tutor: 'Emily Roberts', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['S71', 'B2'], status: 'completed' },
          ],
        },
        {
          id: 'wk-11',
          number: 11,
          title: 'Content Strategy & Execution',
          startDate: '10 Nov 2024',
          endDate: '16 Nov 2024',
          otjh: 22,
          sessions: [
            { id: 's-42', title: 'Content Strategy Principles', type: 'Live Session', day: 'Mon', date: '10 Nov', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K41', 'S61'], status: 'completed' },
            { id: 's-43', title: 'Content Planning Workshop', type: 'Workshop', day: 'Wed', date: '12 Nov', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'James Thompson', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K41', 'S61'], status: 'completed' },
            { id: 's-44', title: 'Content Calendar Assignment', type: 'Assignment', day: 'Thu', date: '13 Nov', startTime: '14:00', endTime: '16:00', duration: 120, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['S61', 'S71'], status: 'completed' },
            { id: 's-45', title: 'Weekly Review', type: 'OTJH', day: 'Fri', date: '14 Nov', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
        {
          id: 'wk-12',
          number: 12,
          title: 'Module 3 Assessment & Review',
          startDate: '17 Nov 2024',
          endDate: '23 Nov 2024',
          otjh: 24,
          sessions: [
            { id: 's-46', title: 'Assessment Prep', type: 'Live Session', day: 'Mon', date: '17 Nov', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K31', 'K41'], status: 'completed' },
            { id: 's-47', title: 'Module 3 Knowledge Test', type: 'Quiz', day: 'Wed', date: '19 Nov', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Auto-marked', venue: 'LMS', deliveryMode: 'Online', ksbRefs: ['K31', 'K41', 'S51'], status: 'completed' },
            { id: 's-48', title: 'Portfolio Review', type: 'Review', day: 'Thu', date: '20 Nov', startTime: '14:00', endTime: '14:45', duration: 45, tutor: 'Sarah Mitchell', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['B1'], status: 'completed' },
            { id: 's-49', title: 'Module 3 Wrap-up', type: 'OTJH', day: 'Fri', date: '21 Nov', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
      ],
    },
    {
      id: 'mod-4',
      name: 'Module 4 — Evaluation, Improvement & EPA Preparation',
      description: 'Bring everything together and prepare for end-point assessment.',
      weeks: 4,
      otjh: 90,
      version: 'v0.3',
      status: 'draft',
      ksbTags: ['K51', 'K41', 'S52', 'S71'],
      ksbMapping: [
        { ksb: 'K51', weight: 40 },
        { ksb: 'K41', weight: 30 },
        { ksb: 'S52', weight: 20 },
        { ksb: 'S71', weight: 20 },
      ],
      weeksData: [
        {
          id: 'wk-13',
          number: 13,
          title: 'Campaign Evaluation Metrics',
          startDate: '24 Nov 2024',
          endDate: '30 Nov 2024',
          otjh: 22,
          sessions: [
            { id: 's-50', title: 'Evaluation Frameworks', type: 'Live Session', day: 'Mon', date: '24 Nov', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Mark Williams', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K51', 'K41'], status: 'completed' },
            { id: 's-51', title: 'KPI Workshop', type: 'Workshop', day: 'Wed', date: '26 Nov', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'Mark Williams', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K51', 'S52'], status: 'completed' },
            { id: 's-52', title: 'Metrics Analysis', type: 'Assignment', day: 'Thu', date: '27 Nov', startTime: '14:00', endTime: '16:00', duration: 120, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['K51', 'S52'], status: 'completed' },
            { id: 's-53', title: 'Weekly OTJH', type: 'OTJH', day: 'Fri', date: '28 Nov', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
        {
          id: 'wk-14',
          number: 14,
          title: 'Continuous Improvement & Optimisation',
          startDate: '1 Dec 2024',
          endDate: '7 Dec 2024',
          otjh: 22,
          sessions: [
            { id: 's-54', title: 'Improvement Methodologies', type: 'Live Session', day: 'Mon', date: '1 Dec', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K51', 'S71'], status: 'completed' },
            { id: 's-55', title: 'A/B Testing Workshop', type: 'Workshop', day: 'Wed', date: '3 Dec', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'James Thompson', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['S52', 'S71'], status: 'completed' },
            { id: 's-56', title: 'Optimisation Exercise', type: 'Assignment', day: 'Thu', date: '4 Dec', startTime: '14:00', endTime: '15:30', duration: 90, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['S52', 'S71'], status: 'completed' },
            { id: 's-57', title: 'Group Discussion', type: 'Collaboration', day: 'Fri', date: '5 Dec', startTime: '10:00', endTime: '11:00', duration: 60, tutor: 'Emily Roberts', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['S71', 'B2'], status: 'completed' },
          ],
        },
        {
          id: 'wk-15',
          number: 15,
          title: 'EPA Preparation & Portfolio Review',
          startDate: '8 Dec 2024',
          endDate: '14 Dec 2024',
          otjh: 22,
          sessions: [
            { id: 's-58', title: 'EPA Overview & Requirements', type: 'Live Session', day: 'Mon', date: '8 Dec', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'James Thompson', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K51', 'K41'], status: 'completed' },
            { id: 's-59', title: 'Portfolio Review Workshop', type: 'Workshop', day: 'Wed', date: '10 Dec', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'James Thompson', venue: 'Room 302', deliveryMode: 'In-person', ksbRefs: ['K51', 'S52'], status: 'completed' },
            { id: 's-60', title: 'Mock Presentation', type: 'Assignment', day: 'Thu', date: '11 Dec', startTime: '14:00', endTime: '16:00', duration: 120, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['S52', 'S71'], status: 'completed' },
            { id: 's-61', title: 'Weekly Review', type: 'OTJH', day: 'Fri', date: '12 Dec', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
        {
          id: 'wk-16',
          number: 16,
          title: 'Final Review & EPA Readiness',
          startDate: '15 Dec 2024',
          endDate: '21 Dec 2024',
          otjh: 24,
          sessions: [
            { id: 's-62', title: 'Final Knowledge Review', type: 'Live Session', day: 'Mon', date: '15 Dec', startTime: '09:30', endTime: '11:00', duration: 90, tutor: 'Mark Williams', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['K51', 'K41'], status: 'completed' },
            { id: 's-63', title: 'Final Assessment', type: 'Quiz', day: 'Wed', date: '17 Dec', startTime: '09:30', endTime: '11:30', duration: 120, tutor: 'Auto-marked', venue: 'LMS', deliveryMode: 'Online', ksbRefs: ['K51', 'K41', 'S52'], status: 'completed' },
            { id: 's-64', title: 'EPA Readiness Check', type: 'Review', day: 'Thu', date: '18 Dec', startTime: '14:00', endTime: '14:45', duration: 45, tutor: 'Sarah Mitchell', venue: 'Teams', deliveryMode: 'Virtual', ksbRefs: ['B1'], status: 'completed' },
            { id: 's-65', title: 'Programme Wrap-up', type: 'OTJH', day: 'Fri', date: '19 Dec', startTime: '16:00', endTime: '16:30', duration: 30, tutor: 'Sarah Mitchell', venue: 'LMS', deliveryMode: 'Async', ksbRefs: ['B1'], status: 'completed' },
          ],
        },
      ],
    },
  ],

  ksbHeatmap: [
    { ksb: 'K1.1', title: 'The marketing concept and its role in organisations', coverage: { M1: 40, M2: null, M3: null, M4: null } },
    { ksb: 'K2.1', title: 'Sources of marketing data and research methods', coverage: { M1: null, M2: 25, M3: null, M4: null } },
    { ksb: 'K2.2', title: 'How customer insight informs marketing decisions', coverage: { M1: null, M2: 30, M3: null, M4: null } },
    { ksb: 'K3.1', title: 'Marketing planning frameworks and campaign principles', coverage: { M1: null, M2: null, M3: 25, M4: null } },
    { ksb: 'K4.1', title: 'Digital channels and their use in marketing', coverage: { M1: null, M2: null, M3: 30, M4: null } },
    { ksb: 'K5.1', title: 'Measuring and evaluating marketing performance', coverage: { M1: null, M2: null, M3: null, M4: 40 } },
    { ksb: 'S1.1', title: 'Use data and analytics to support marketing decisions', coverage: { M1: null, M2: 25, M3: null, M4: 20 } },
    { ksb: 'S1.2', title: 'Interpret research findings to recommend actions', coverage: { M1: null, M2: 10, M3: null, M4: null } },
    { ksb: 'S5.1', title: 'Plan and contribute to marketing campaigns', coverage: { M1: null, M2: null, M3: 20, M4: null } },
    { ksb: 'S7.1', title: 'Apply digital tools to deliver marketing activity', coverage: { M1: null, M2: null, M3: 15, M4: null } },
    { ksb: 'S1.2', title: 'Collaborate effectively within a marketing team', coverage: { M1: 20, M2: 5, M3: null, M4: null } },
    { ksb: 'B1.1', title: 'Acts ethically and with integrity in marketing practice', coverage: { M1: null, M2: null, M3: null, M4: null } },
    { ksb: 'B1.2', title: 'Reflects on practice and applies learning at work', coverage: { M1: 20, M2: null, M3: null, M4: null } },
    { ksb: 'B1.3', title: 'Resilient and adaptable in changing marketing contexts', coverage: { M1: 20, M2: 5, M3: null, M4: 20 } },
  ],

  staffing: [
    { coach: 'Sarah Mitchell', tutor: 'James Thompson', groups: 'A1, B1', cohorts: 'A, B', status: 'active', role: 'Coach / Tutor' },
    { coach: 'David Chen', tutor: 'Emily Roberts', groups: 'A2', cohorts: 'A', status: 'active', role: 'Coach / Tutor' },
    { coach: 'Lisa Park', tutor: 'Mark Williams', groups: 'B2', cohorts: 'B', status: 'active', role: 'Coach / Tutor' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Type badge colours
// ─────────────────────────────────────────────────────────────────────────────

const typeColors: Record<string, string> = {
  'Live Session': 'bg-primary-100 text-primary-700',
  'Workshop': 'bg-accent-100 text-accent-700',
  'Self-study': 'bg-secondary-100 text-secondary-700',
  'Assignment': 'bg-amber-100 text-amber-700',
  'Quiz': 'bg-rose-100 text-rose-700',
  'OTJH': 'bg-emerald-100 text-emerald-700',
  'Collaboration': 'bg-violet-100 text-violet-700',
  'Review': 'bg-sky-100 text-sky-700',
};

const sessionStatusColors: Record<string, string> = {
  scheduled: 'bg-primary-100 text-primary-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
};

const moduleStatusColors: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  approved: 'bg-sky-50 text-sky-700 border-sky-200/50',
  'in-review': 'bg-amber-50 text-amber-700 border-amber-200/50',
  draft: 'bg-foreground-100 text-foreground-500 border-foreground-200/50',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ProgrammeDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<'overview' | 'cohorts' | 'groups' | 'modules' | 'weeks' | 'sessions' | 'ksb' | 'staffing'>('overview');
  const [selectedCohort, setSelectedCohort] = useState<string>(PROGRAMME.cohorts[0]?.id || '');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedModule, setSelectedModule] = useState<string>(PROGRAMME.modules[0]?.id || '');
  const [selectedWeek, setSelectedWeek] = useState<string>(PROGRAMME.modules[0]?.weeksData[0]?.id || '');
  const [sessionFilter, setSessionFilter] = useState<string>('all');
  const [expandedCohort, setExpandedCohort] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [assignMode, setAssignMode] = useState<string | null>(null);

  const cohort = PROGRAMME.cohorts.find(c => c.id === selectedCohort) || PROGRAMME.cohorts[0];
  const module = PROGRAMME.modules.find(m => m.id === selectedModule) || PROGRAMME.modules[0];
  const week = module?.weeksData.find(w => w.id === selectedWeek) || module?.weeksData[0];

  const allSessions = PROGRAMME.modules.flatMap(m => m.weeksData.flatMap(w => w.sessions));
  const filteredSessions = sessionFilter === 'all' ? allSessions : allSessions.filter(s => s.status === sessionFilter);

  const totalSessions = allSessions.length;
  const completedSessions = allSessions.filter(s => s.status === 'completed').length;
  const totalOtjh = PROGRAMME.modules.reduce((a, m) => a + m.otjh, 0);
  const totalLearners = PROGRAMME.cohorts.reduce((a, c) => a + c.learners, 0);
  const totalGroups = PROGRAMME.cohorts.reduce((a, c) => a + c.groups.length, 0);

  const tabs = [
    { key: 'overview' as const, label: 'Overview & Intent', icon: 'ri-file-info-line' },
    { key: 'cohorts' as const, label: 'Cohorts', icon: 'ri-group-line' },
    { key: 'groups' as const, label: 'Groups', icon: 'ri-team-line' },
    { key: 'modules' as const, label: 'Modules', icon: 'ri-stack-line' },
    { key: 'weeks' as const, label: 'Weeks', icon: 'ri-calendar-line' },
    { key: 'sessions' as const, label: 'Sessions', icon: 'ri-time-line' },
    { key: 'ksb' as const, label: 'KSB Heatmap', icon: 'ri-bar-chart-line' },
    { key: 'staffing' as const, label: 'Staffing', icon: 'ri-user-settings-line' },
  ];

  return (
    <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems} workspaceLabel="Curriculum Studio" pageTitle={`${PROGRAMME.name} ${PROGRAMME.level}`} pageSubtitle={`${PROGRAMME.standard} · ${PROGRAMME.duration} · ${PROGRAMME.cohorts.length} cohorts · ${PROGRAMME.modules.length} modules`} userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* ── Programme Header ── */}
        <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">{PROGRAMME.cohorts.length} cohorts · {PROGRAMME.modules.length} modules · {PROGRAMME.standard} · {PROGRAMME.level}</span>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary-500 text-white">{PROGRAMME.status}</span>
              </div>
              <h1 className="text-xl font-heading font-bold text-foreground-900">{PROGRAMME.name} {PROGRAMME.level}</h1>
              <p className="text-[13px] text-foreground-500 mt-1">{PROGRAMME.description}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-edit-line mr-1"></i> Edit Programme
              </button>
              <button className="px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                <i className="ri-file-list-3-line mr-1"></i> View Standard
              </button>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5 pt-4 border-t border-foreground-200/60">
            <StatPill icon="ri-group-line" value={PROGRAMME.cohorts.length} label="Cohorts" />
            <StatPill icon="ri-team-line" value={totalGroups} label="Groups" />
            <StatPill icon="ri-graduation-cap-line" value={totalLearners} label="Learners" />
            <StatPill icon="ri-stack-line" value={PROGRAMME.modules.length} label="Modules" />
            <StatPill icon="ri-time-line" value={totalOtjh} label="Total OTJH" />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer shrink-0 ${tab === t.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <i className={`${t.icon} text-[13px]`}></i>
              {t.label}
              {t.key === 'modules' && <span className="text-[9px] bg-foreground-200/50 px-1 rounded-full">{PROGRAMME.modules.length}</span>}
              {t.key === 'cohorts' && <span className="text-[9px] bg-foreground-200/50 px-1 rounded-full">{PROGRAMME.cohorts.length}</span>}
              {t.key === 'groups' && <span className="text-[9px] bg-foreground-200/50 px-1 rounded-full">{totalGroups}</span>}
              {t.key === 'sessions' && <span className="text-[9px] bg-foreground-200/50 px-1 rounded-full">{totalSessions}</span>}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: Overview & Intent
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <div className="space-y-5">
            {/* Programme Intent */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Programme Intent</h3>
              <div className="space-y-4">
                <IntentBlock label="Intent" text={PROGRAMME.intent} />
                <IntentBlock label="Curriculum Rationale" text={PROGRAMME.rationale} />
                <IntentBlock label="Learner Benefit" text={PROGRAMME.learnerBenefit} />
                <IntentBlock label="Employer Benefit" text={PROGRAMME.employerBenefit} />
                <IntentBlock label="EPA Overview" text={PROGRAMME.epaOverview} />
              </div>
              <div className="mt-4 pt-4 border-t border-foreground-200/60">
                <h4 className="text-[12px] font-semibold text-foreground-700 mb-2">Professional Qualifications</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  {PROGRAMME.qualifications.map((q, i) => (
                    <span key={i} className="text-[12px] font-medium text-foreground-700 bg-background-100 px-3 py-1.5 rounded-lg border border-foreground-200/60">{q}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* KSB Groups */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">KSB Groups</h3>
              <p className="text-[12px] text-foreground-400 mb-3">Main and secondary KSBs covered at programme level.</p>
              <div className="mb-4">
                <h4 className="text-[11px] font-semibold text-foreground-500 uppercase mb-2">Main ({PROGRAMME.mainKsbs.length})</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  {PROGRAMME.mainKsbs.map(k => (
                    <span key={k} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-primary-50 text-primary-700 border border-primary-200/50">{k}</span>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-[11px] font-semibold text-foreground-500 uppercase mb-2">Secondary ({PROGRAMME.secondaryKsbs.length})</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  {PROGRAMME.secondaryKsbs.map(k => (
                    <span key={k} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-secondary-100 text-secondary-700 border border-secondary-200/50">{k}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: Cohorts
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'cohorts' && (
          <div className="space-y-4">
            {PROGRAMME.cohorts.map(c => (
              <div key={c.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                {/* Cohort Header — Clickable */}
                <button onClick={() => setExpandedCohort(expandedCohort === c.id ? null : c.id)} className="w-full flex items-center gap-4 p-4 text-left cursor-pointer hover:bg-background-100/30 transition-smooth">
                  <span className="w-10 h-10 rounded-xl bg-secondary-100 flex items-center justify-center shrink-0">
                    <i className={`ri-arrow-down-s-line text-secondary-700 transition-smooth ${expandedCohort === c.id ? 'rotate-180' : ''}`}></i>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{c.name}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${c.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' : c.status === 'planned' ? 'bg-accent-50 text-accent-700 border-accent-200/50' : 'bg-foreground-100 text-foreground-500 border-foreground-200/50'}`}>{c.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{c.startDate} — {c.endDate} · {c.learners} learners · {c.groups.length} groups</p>
                  </div>
                  <div className="flex items-center gap-4 text-[12px] text-foreground-500 shrink-0">
                    {c.status === 'active' && (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-background-200 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${c.progress}%` }}></div>
                        </div>
                        <span className="text-[10px] font-semibold">{c.progress}%</span>
                        <span className="text-[10px] text-foreground-400"><i className="ri-check-double-line mr-0.5"></i>{c.attendance}% att.</span>
                      </div>
                    )}
                    <span className="text-[12px]"><i className="ri-graduation-cap-line mr-1"></i>{c.learners}</span>
                  </div>
                </button>

                {/* Expanded Groups */}
                {expandedCohort === c.id && (
                  <div className="px-4 pb-4 border-t border-background-200/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                      {c.groups.map(g => (
                        <div key={g.id} className="bg-background-100 rounded-xl border border-foreground-200/60 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[13px] font-semibold text-foreground-900">{g.name}</p>
                            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{g.status}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <div className="text-[11px] text-foreground-500"><i className="ri-graduation-cap-line mr-1 text-[10px]"></i>{g.learners} learners</div>
                            <div className="text-[11px] text-foreground-500"><i className="ri-heart-line mr-1 text-[10px]"></i>Coach: {g.coach}</div>
                            <div className="text-[11px] text-foreground-500"><i className="ri-user-settings-line mr-1 text-[10px]"></i>Tutor: {g.tutor}</div>
                            <div className="text-[11px] text-foreground-500"><i className="ri-calendar-line mr-1 text-[10px]"></i>{g.schedule}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-foreground-400 bg-background-200/50 px-2 py-0.5 rounded">{g.mode}</span>
                            <span className="text-[10px] text-foreground-400">{g.startDate} — {g.endDate}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-3">
                            <Link to={`/curriculum/cohorts/${c.id}`} className="px-2.5 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">View Full Details</Link>
                            <button className="px-2.5 py-1 bg-background-50 border border-background-200 rounded-md text-[10px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Assign Staff</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Link to={`/curriculum/cohorts/${c.id}/allocate`} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-user-add-line mr-1"></i> Allocate Learners
                      </Link>
                      <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-add-line mr-1"></i> New Group
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: Groups
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'groups' && (
          <div className="space-y-4">
            {PROGRAMME.cohorts.map(c => (
              <div key={c.id} className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-semibold text-foreground-700">{c.name}</span>
                  <span className="text-[10px] text-foreground-400">{c.groups.length} groups · {c.learners} learners</span>
                </div>
                {c.groups.map(g => (
                  <div key={g.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
                    <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-secondary-100 flex items-center justify-center shrink-0">
                        <i className="ri-team-line text-secondary-700 text-lg"></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground-900">{g.name}</p>
                          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{c.name}</span>
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${g.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{g.status}</span>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-foreground-500 mt-1 flex-wrap">
                          <span><i className="ri-graduation-cap-line mr-1 text-[10px]"></i>{g.learners} learners</span>
                          <span><i className="ri-heart-line mr-1 text-[10px]"></i>Coach: <strong className="text-foreground-700">{g.coach}</strong></span>
                          <span><i className="ri-user-settings-line mr-1 text-[10px]"></i>Tutor: <strong className="text-foreground-700">{g.tutor}</strong></span>
                          <span><i className="ri-calendar-line mr-1 text-[10px]"></i>{g.schedule}</span>
                          <span><i className="ri-map-pin-line mr-1 text-[10px]"></i>{g.mode}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => setAssignMode(assignMode === g.id ? null : g.id)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          <i className="ri-user-add-line mr-1"></i> Assign Staff
                        </button>
                        <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                          <i className="ri-edit-line mr-1"></i> Edit
                        </button>
                      </div>
                    </div>

                    {/* Assign Staff Panel */}
                    {assignMode === g.id && (
                      <div className="mt-4 p-4 bg-background-100 rounded-xl border border-foreground-200/60">
                        <h4 className="text-[12px] font-semibold text-foreground-700 mb-3">Assign Coach & Tutor</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="text-[11px] font-medium text-foreground-500 mb-1 block">Coach</label>
                            <select className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer">
                              <option>{g.coach}</option>
                              <option>Sarah Mitchell</option>
                              <option>David Chen</option>
                              <option>Lisa Park</option>
                              <option>Michael Brown</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-foreground-500 mb-1 block">Tutor</label>
                            <select className="w-full px-3 py-2 rounded-lg border border-background-200 bg-background-50 text-[13px] text-foreground-900 outline-none cursor-pointer">
                              <option>{g.tutor}</option>
                              <option>James Thompson</option>
                              <option>Emily Roberts</option>
                              <option>Mark Williams</option>
                              <option>Jessica Adams</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Save Assignment</button>
                          <button onClick={() => setAssignMode(null)} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: Modules
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'modules' && (
          <div className="space-y-4">
            {PROGRAMME.modules.map((mod, idx) => (
              <div key={mod.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                      <i className="ri-stack-line text-sm"></i>
                    </span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{mod.name}</p>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${moduleStatusColors[mod.status]}`}>{mod.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{mod.description}</p>
                    </div>
                  </div>
                </div>

                {/* KSB Tags */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  {mod.ksbTags.map(ksb => (
                    <span key={ksb} className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-secondary-100 text-secondary-700">{ksb}</span>
                  ))}
                </div>

                {/* Module Info Row */}
                <div className="flex items-center gap-4 text-[12px] text-foreground-500 mb-4">
                  <span><i className="ri-calendar-line mr-1 text-[10px]"></i>~{mod.weeks} months</span>
                  <span><i className="ri-time-line mr-1 text-[10px]"></i>{mod.otjh}h OTJH</span>
                  <span><i className="ri-file-list-3-line mr-1 text-[10px]"></i>v{mod.version}</span>
                </div>

                {/* KSB Mapping Bars */}
                <div className="mb-4">
                  <p className="text-[11px] font-semibold text-foreground-400 uppercase mb-2">KSB Coverage</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    {mod.ksbMapping.map(km => (
                      <div key={km.ksb} className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-foreground-500 w-8">{km.ksb}</span>
                        <div className="w-16 h-1.5 bg-background-200 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${km.weight}%` }}></div>
                        </div>
                        <span className="text-[10px] font-semibold text-foreground-500">{km.weight}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-background-200/30">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-eye-line mr-1"></i> View Module
                  </button>
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-arrow-right-line mr-1"></i> Open Module Builder
                  </button>
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-link mr-1"></i> KSB Mapping
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: Weeks
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'weeks' && (
          <div className="space-y-4">
            {/* Module Selector */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-foreground-400 uppercase">Select Module:</span>
              {PROGRAMME.modules.map(m => (
                <button key={m.id} onClick={() => { setSelectedModule(m.id); setSelectedWeek(m.weeksData[0]?.id || ''); }} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${selectedModule === m.id ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-600 hover:bg-background-200'}`}>
                  {m.name.split('—')[0].trim()}
                </button>
              ))}
            </div>

            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{module.name}</h3>
                  <p className="text-[11px] text-foreground-400 mt-0.5">{module.weeksData.length} weeks · {module.otjh}h OTJH</p>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${moduleStatusColors[module.status]}`}>{module.status}</span>
              </div>

              <div className="space-y-3">
                {module.weeksData.map(w => (
                  <div key={w.id} className="border border-foreground-200/60 rounded-xl overflow-hidden">
                    <button onClick={() => setSelectedWeek(selectedWeek === w.id ? '' : w.id)} className="w-full flex items-center gap-3 p-4 text-left cursor-pointer hover:bg-background-100/30 transition-smooth">
                      <span className="text-[10px] font-semibold text-foreground-300 w-8">W{w.number}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground-900">{w.title}</p>
                        <p className="text-[11px] text-foreground-400">{w.startDate} — {w.endDate} · {w.otjh}h OTJH · {w.sessions.length} sessions</p>
                      </div>
                      <i className={`ri-arrow-down-s-line text-foreground-400 transition-smooth ${selectedWeek === w.id ? 'rotate-180' : ''}`}></i>
                    </button>
                    {selectedWeek === w.id && (
                      <div className="px-4 pb-4 border-t border-background-200/30">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                          {w.sessions.map((s, i) => (
                            <div key={s.id} className="flex items-center gap-3 p-3 bg-background-100 rounded-lg border border-foreground-200/60">
                              <span className="text-[10px] font-semibold text-foreground-300 w-5">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-medium text-foreground-900 truncate">{s.title}</p>
                                <div className="flex items-center gap-2 flex-wrap mt-1">
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${typeColors[s.type] || 'bg-foreground-100 text-foreground-500'}`}>{s.type}</span>
                                  <span className="text-[10px] text-foreground-400">{s.day} {s.date} · {s.startTime}—{s.endTime}</span>
                                  <span className="text-[10px] text-foreground-400"><i className="ri-user-line mr-0.5 text-[9px]"></i>{s.tutor}</span>
                                </div>
                              </div>
                              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sessionStatusColors[s.status]}`}>{s.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: Sessions
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'sessions' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-foreground-400 uppercase">Filter:</span>
              {['all', 'completed', 'scheduled', 'cancelled', 'pending'].map(f => (
                <button key={f} onClick={() => setSessionFilter(f)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth cursor-pointer whitespace-nowrap ${sessionFilter === f ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-600 hover:bg-background-200'}`}>
                  {f === 'all' ? 'All Sessions' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
              <span className="text-[11px] text-foreground-400 ml-2">{filteredSessions.length} of {totalSessions} sessions</span>
            </div>

            {/* Sessions Table */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="grid grid-cols-[2fr_0.8fr_0.8fr_1fr_1fr_0.8fr_0.8fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                <span>Session</span>
                <span className="text-center">Type</span>
                <span className="text-center">Day</span>
                <span className="text-center">Time</span>
                <span className="text-center">Tutor</span>
                <span className="text-center">Duration</span>
                <span className="text-center">Status</span>
              </div>
              <div className="divide-y divide-background-200/30">
                {filteredSessions.map((s, i) => (
                  <div key={s.id} className="grid grid-cols-[2fr_0.8fr_0.8fr_1fr_1fr_0.8fr_0.8fr] gap-3 px-4 py-3 items-center hover:bg-background-100/30 transition-smooth">
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-foreground-900 truncate">{s.title}</p>
                      <p className="text-[10px] text-foreground-400">{s.date} · {s.venue}</p>
                    </div>
                    <div className="flex justify-center">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${typeColors[s.type] || 'bg-foreground-100 text-foreground-500'}`}>{s.type}</span>
                    </div>
                    <span className="text-[11px] text-foreground-500 text-center">{s.day}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{s.startTime}—{s.endTime}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{s.tutor}</span>
                    <span className="text-[11px] text-foreground-500 text-center">{s.duration}m</span>
                    <div className="flex justify-center">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sessionStatusColors[s.status]}`}>{s.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: KSB Heatmap
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'ksb' && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">KSB Coverage Heatmap</h3>
              <p className="text-[12px] text-foreground-400 mt-1">Weight of each KSB within each module. Empty cells indicate the KSB is not addressed in that module.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-foreground-400/50">
                    <th className="text-left py-2 px-3 font-semibold text-foreground-400">KSB</th>
                    {PROGRAMME.moduleNames.map(mn => (
                      <th key={mn} className="text-center py-2 px-3 font-semibold text-foreground-400">{mn}</th>
                    ))}
                    <th className="text-left py-2 px-3 font-semibold text-foreground-400">Title</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-background-200/30">
                  {PROGRAMME.ksbHeatmap.map((row, i) => (
                    <tr key={i} className="hover:bg-background-100/30 transition-smooth">
                      <td className="py-2.5 px-3 font-semibold text-foreground-700">{row.ksb}</td>
                      {PROGRAMME.moduleNames.map(mn => {
                        const val = row.coverage[mn];
                        return (
                          <td key={mn} className="py-2.5 px-3 text-center">
                            {val !== null && val !== undefined ? (
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-primary-100 text-primary-700">{val}%</span>
                            ) : (
                              <span className="text-foreground-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3 text-foreground-500">{row.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            TAB: Staffing
        ═══════════════════════════════════════════════════════════════════════ */}
        {tab === 'staffing' && (
          <div className="space-y-4">
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Coach & Tutor Assignment</h3>
                  <p className="text-[12px] text-foreground-400 mt-1">Manage staff allocation across cohorts and groups.</p>
                </div>
                <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-add-line mr-1"></i> New Assignment
                </button>
              </div>

              <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="grid grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                  <span>Coach</span>
                  <span>Tutor</span>
                  <span className="text-center">Groups</span>
                  <span className="text-center">Cohorts</span>
                  <span className="text-center">Status</span>
                  <span className="text-center">Action</span>
                </div>
                <div className="divide-y divide-background-200/30">
                  {PROGRAMME.staffing.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_0.8fr] gap-3 px-4 py-3.5 items-center hover:bg-background-100/30 transition-smooth">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-bold">
                          {s.coach.split(' ').map(n => n[0]).join('')}
                        </span>
                        <span className="text-[12px] font-medium text-foreground-900">{s.coach}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-[10px] font-bold">
                          {s.tutor.split(' ').map(n => n[0]).join('')}
                        </span>
                        <span className="text-[12px] font-medium text-foreground-900">{s.tutor}</span>
                      </div>
                      <span className="text-[11px] text-foreground-500 text-center">{s.groups}</span>
                      <span className="text-[11px] text-foreground-500 text-center">{s.cohorts}</span>
                      <div className="flex justify-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
                      </div>
                      <div className="flex justify-center gap-1">
                        <button className="w-7 h-7 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center hover:bg-primary-200 transition-smooth cursor-pointer">
                          <i className="ri-edit-line text-xs"></i>
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-background-100 text-foreground-500 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-smooth cursor-pointer">
                          <i className="ri-delete-bin-line text-xs"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Unassigned Groups */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Unassigned Groups</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-amber-50 rounded-xl border border-amber-200/50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <i className="ri-alert-line text-amber-600 text-sm"></i>
                    <p className="text-[13px] font-semibold text-amber-800">Group C1</p>
                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Cohort C</span>
                  </div>
                  <p className="text-[11px] text-amber-700 mb-3">No coach or tutor assigned. Programme starts Sep 2025.</p>
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-user-add-line mr-1"></i> Assign Now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Components
// ─────────────────────────────────────────────────────────────────────────────

function StatPill({ icon, value, label }: { icon: string; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-2 bg-background-100 rounded-lg p-3">
      <i className={`${icon} text-foreground-400 text-sm`}></i>
      <div>
        <p className="text-sm font-bold text-foreground-900">{value}</p>
        <p className="text-[9px] text-foreground-400 uppercase">{label}</p>
      </div>
    </div>
  );
}

function IntentBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-foreground-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-[13px] text-foreground-700 leading-relaxed">{text}</p>
    </div>
  );
}