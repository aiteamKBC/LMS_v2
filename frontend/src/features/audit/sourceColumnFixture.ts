import type { AuditLearnerSummary, AuditMonth, AuditRow, AuditWeek, LearnerAuditResponse, LmsAuditItem } from './api';

type SourceWeek = {
  week_key: string;
  label: string;
  date: string;
  start_date: string;
  end_date: string;
  lectures_or_components: string[];
  lectures_or_components_count: number;
  allocation_note: string;
};

type SourceMonth = {
  month_key: string;
  label: string;
  source: string;
  aptem_components: string[];
  aptem_components_match: {
    rule: string;
    matched_count: number;
    available_aptem_components_in_month: number;
  };
  weeks: SourceWeek[];
};

type SourceModule = {
  name: string;
  source: 'LMS';
  course_id: number;
  category: string;
  status: string;
  progress_percent: number;
  components_total: number;
  components_completed: number;
  months: SourceMonth[];
};

const sourceModules: SourceModule[] = [
  {
    name: 'G2- Ray -Project Management Professional - Jan 26',
    source: 'LMS',
    course_id: 115253,
    category: 'Project Controls Professional Level 6 - Feb 2026',
    status: 'enrolled',
    progress_percent: 41,
    components_total: 286,
    components_completed: 18,
    months: [
      {
        month_key: '2026-02',
        label: 'February 2026',
        source: 'Aptem/LMS month match',
        aptem_components: [],
        aptem_components_match: {
          rule: 'same month plus title/module token overlap',
          matched_count: 0,
          available_aptem_components_in_month: 0,
        },
        weeks: [
          {
            week_key: '2026-02-01',
            label: '1-7 Feb',
            date: '2026-02-18',
            start_date: '2026-02-01',
            end_date: '2026-02-07',
            lectures_or_components: [
              'P1: Introduction to Safeguarding / Programme Overview',
              'P2: Project Management versus Project Control',
              'P3: KSBs / Programme Schedule',
              'Powerpoint 1: Introduction, Safeguarding and Membership',
            ],
            lectures_or_components_count: 4,
            allocation_note: 'LMS does not provide per-lecture dates; completed material titles are distributed across the LMS month weeks in source order.',
          },
          {
            week_key: '2026-02-08',
            label: '8-14 Feb',
            date: '2026-02-18',
            start_date: '2026-02-08',
            end_date: '2026-02-14',
            lectures_or_components: [
              'P1-TB-Safeguarding and British Values',
              'Chapter 1: Project Management/Control KSBs, Knowledge Areas, Domains, and Competences (ChPP)',
              'P1-AUD-Programme Vs Portfolio Podcast',
            ],
            lectures_or_components_count: 3,
            allocation_note: 'LMS does not provide per-lecture dates; completed material titles are distributed across the LMS month weeks in source order.',
          },
          {
            week_key: '2026-02-15',
            label: '15-21 Feb',
            date: '2026-02-18',
            start_date: '2026-02-15',
            end_date: '2026-02-21',
            lectures_or_components: [
              'P3-PPT- Overview of the Programme and assignment',
              'PMI Code of Ethics - pdf',
              'Additional Reading: What is Project?',
              'P1-A system of Value Delivery',
            ],
            lectures_or_components_count: 4,
            allocation_note: 'LMS does not provide per-lecture dates; completed material titles are distributed across the LMS month weeks in source order.',
          },
          {
            week_key: '2026-02-22',
            label: '22-28 Feb',
            date: '2026-02-18',
            start_date: '2026-02-22',
            end_date: '2026-02-28',
            lectures_or_components: [
              'P1-PPT-A system of Value Delivery',
              'P2-PPT-Project, Programme and Portfolio',
              'Differences between Project, Program, and Portfolio Management',
            ],
            lectures_or_components_count: 3,
            allocation_note: 'LMS does not provide per-lecture dates; completed material titles are distributed across the LMS month weeks in source order.',
          },
        ],
      },
    ],
  },
  {
    name: 'Project Controls Professional L6 : KSBs',
    source: 'LMS',
    course_id: 103722,
    category: 'Project Control Professional',
    status: 'enrolled',
    progress_percent: 0,
    components_total: 222,
    components_completed: 0,
    months: [
      {
        month_key: '2026-01',
        label: 'January 2026',
        source: 'Aptem/LMS month match',
        aptem_components: [],
        aptem_components_match: {
          rule: 'same month plus title/module token overlap',
          matched_count: 0,
          available_aptem_components_in_month: 0,
        },
        weeks: [
          emptyWeek('2026-01-01', '1-7 Jan', '2026-01-30', '2026-01-01', '2026-01-07'),
          emptyWeek('2026-01-08', '8-14 Jan', '2026-01-30', '2026-01-08', '2026-01-14'),
          emptyWeek('2026-01-15', '15-21 Jan', '2026-01-30', '2026-01-15', '2026-01-21'),
          emptyWeek('2026-01-22', '22-28 Jan', '2026-01-30', '2026-01-22', '2026-01-28'),
          emptyWeek('2026-01-29', '29-31 Jan', '2026-01-30', '2026-01-29', '2026-01-31'),
        ],
      },
    ],
  },
  {
    name: 'Safeguarding For Learners',
    source: 'LMS',
    course_id: 89537,
    category: 'General',
    status: 'enrolled',
    progress_percent: 0,
    components_total: 24,
    components_completed: 0,
    months: [
      {
        month_key: '2026-02',
        label: 'February 2026',
        source: 'Aptem/LMS month match',
        aptem_components: [],
        aptem_components_match: {
          rule: 'same month plus title/module token overlap',
          matched_count: 0,
          available_aptem_components_in_month: 0,
        },
        weeks: [
          emptyWeek('2026-02-01', '1-7 Feb', '2026-02-24', '2026-02-01', '2026-02-07'),
          emptyWeek('2026-02-08', '8-14 Feb', '2026-02-24', '2026-02-08', '2026-02-14'),
          emptyWeek('2026-02-15', '15-21 Feb', '2026-02-24', '2026-02-15', '2026-02-21'),
          emptyWeek('2026-02-22', '22-28 Feb', '2026-02-24', '2026-02-22', '2026-02-28'),
        ],
      },
    ],
  },
];

export const sourceColumnLearners: AuditLearnerSummary[] = [
  {
    learnerId: '6441',
    fullName: 'Aaran Bellman',
    programName: 'learner-source-data-v7',
    completedOtjh: null,
    aptemComponentCount: 0,
    hasAptemData: true,
    hasLmsData: true,
    warnings: [],
  },
];

export const sourceColumnAuditByLearnerId: Record<string, LearnerAuditResponse> = {
  '6441': buildSourceColumnAudit(),
};

export function filterSourceColumnLearners(search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return sourceColumnLearners;
  return sourceColumnLearners.filter((learner) => [learner.learnerId, learner.fullName, learner.programName].join(' ').toLowerCase().includes(needle));
}

function emptyWeek(week_key: string, label: string, date: string, start_date: string, end_date: string): SourceWeek {
  return {
    week_key,
    label,
    date,
    start_date,
    end_date,
    lectures_or_components: [],
    lectures_or_components_count: 0,
    allocation_note: 'LMS does not provide per-lecture dates; completed material titles are distributed across the LMS month weeks in source order.',
  };
}

function buildSourceColumnAudit(): LearnerAuditResponse {
  const monthMap = new Map<string, AuditMonth>();
  let completed = 0;
  let total = 0;

  sourceModules.forEach((module) => {
    completed += module.components_completed;
    total += module.components_total;
    module.months.forEach((month) => {
      if (!monthMap.has(month.month_key)) {
        monthMap.set(month.month_key, {
          month_key: month.month_key,
          label: month.label,
          summary: {
            actual_hours: 0,
            planned_hours: 0,
            aptem_items: month.aptem_components.length,
            lms_items: 0,
            completed: 0,
            in_progress: 0,
            not_started: 0,
            warnings: 0,
          },
          weeks: [],
          undated_items: [],
          signoffs: { learner: null, coach: null },
        });
      }

      const auditMonth = monthMap.get(month.month_key)!;
      month.weeks.forEach((week) => {
        let auditWeek = auditMonth.weeks.find((entry) => entry.week_key === week.week_key);
        if (!auditWeek) {
          auditWeek = {
            week_key: week.week_key,
            label: week.label,
            start_date: week.start_date,
            end_date: week.end_date,
            aptem_items: [],
            lms_items: [],
            source_column: 'LMS_modules_details',
            source_note: week.allocation_note,
            source_modules: [],
          };
          auditMonth.weeks.push(auditWeek);
        }
        auditWeek.source_modules = Array.from(new Set([...(auditWeek.source_modules || []), module.name]));
        auditWeek.lms_items.push(...week.lectures_or_components.map((title, index) => lmsItem(module, month, week, title, index)));
      });
    });
  });

  const months = Array.from(monthMap.values())
    .map((month) => recomputeSourceMonth(month))
    .sort((a, b) => a.month_key.localeCompare(b.month_key));

  return {
    learnerId: '6441',
    learner: {
      id: 6441,
      name: 'Aaran Bellman',
      programme_name: 'learner-source-data-v7',
      programme_key: 'learner-source-data-v7',
      programme_start_date: null,
      employer: null,
      epa: null,
      epao: null,
      company_logo_url: null,
    },
    summary: {
      completed_otjh: null,
      approved_hours: null,
      planned_hours_month: null,
      planned_hours_to_date: null,
      total_programme_planned_hours: null,
      ksb_progression: null,
      lms_progress: 41,
      tracked_seconds: null,
      components_completed: completed,
      components_total: total,
      quiz_attempts: 6,
    },
    months,
    signoffs: Object.fromEntries(months.map((month) => [month.month_key, month.signoffs])),
    warnings: [],
    field_sources: {
      learner: { table: 'learner-source-data-v7.programme.learner', column: 'id/name/completed_otjh', join_key: 'learner.id', fallback: null },
      programme: { table: 'learner-source-data-v7.programme', column: 'Programme_name, Aptem_components', join_key: 'learner.id', fallback: 'programme.name is null in source' },
      months: { table: 'learner-source-data-v7.programme.modules[].months', column: 'Aptem_components', join_key: 'month_key', fallback: null },
      weeks: { table: 'learner-source-data-v7.programme.modules[].months[].weeks', column: 'LMS_modules_details', join_key: 'week_key', fallback: null },
      modules: { table: 'learner-source-data-v7.programme.modules', column: 'LMS_modules_details', join_key: 'course_id', fallback: null },
      components_or_lecture_summaries: { table: 'learner-source-data-v7.lms', column: 'LMS_modules_details.items[].Completed Material Titles', join_key: 'course_id + month_key + week_key', fallback: 'split from Completed Material Titles' },
    },
    source_status: {
      has_aptem_data: true,
      has_lms_data: true,
      lms_summary_fallback: false,
      quiz_summary_fallback: false,
    },
    audit_version: 'learner-source-data-v7',
    snapshot_hash: 'learner-source-data-v7-6441',
  };
}

function lmsItem(module: SourceModule, month: SourceMonth, week: SourceWeek, title: string, index: number): LmsAuditItem {
  const raw: AuditRow = {
    learner_id: 6441,
    learner_name: 'Aaran Bellman',
    module: module.name,
    source: module.source,
    course_id: module.course_id,
    category: module.category,
    module_status: module.status,
    module_progress_percent: module.progress_percent,
    module_components_completed: module.components_completed,
    module_components_total: module.components_total,
    month_key: month.month_key,
    month_label: month.label,
    month_source: month.source,
    week_key: week.week_key,
    week_label: week.label,
    completed_material_title: title,
    lectures_or_components_count: week.lectures_or_components_count,
    allocation_note: week.allocation_note,
    source_column: 'LMS_modules_details',
    aptem_match_rule: month.aptem_components_match.rule,
    aptem_matched_count: month.aptem_components_match.matched_count,
  };

  return {
    id: `source-lms-${module.course_id}-${week.week_key}-${index}`,
    source: 'LMS',
    source_id: `${module.course_id}:${week.week_key}:${index + 1}`,
    relevant_date: week.date,
    date_source: 'LMS_modules_details.Course Completed At',
    match_status: 'LMS Only',
    match_reason: month.aptem_components_match.rule,
    matched_source_ids: [],
    warning_codes: [],
    warnings: [],
    raw,
    course_module: module.name,
    component_name: title,
    component_type: inferComponentType(title),
    completion_status: 'Completed',
    tracked_seconds: null,
    quiz_attempts: null,
    quiz_score: null,
    tutor: '',
    course_started_at: null,
    course_completed_at: week.date,
  };
}

function inferComponentType(title: string) {
  const bracketType = title.match(/\[(.*?)\]/)?.[1];
  if (bracketType) return bracketType;
  const lower = title.toLowerCase();
  if (lower.includes('podcast') || lower.includes('audio')) return 'audio';
  if (lower.includes('video')) return 'video';
  if (lower.includes('ppt') || lower.includes('powerpoint')) return 'presentation';
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('reading') || lower.includes('chapter')) return 'text';
  return 'component';
}

function recomputeSourceMonth(month: AuditMonth): AuditMonth {
  const lmsItems = month.weeks.flatMap((week) => week.lms_items);
  return {
    ...month,
    weeks: month.weeks.sort((a, b) => a.week_key.localeCompare(b.week_key)),
    summary: {
      ...month.summary,
      lms_items: lmsItems.length,
      completed: lmsItems.length,
      in_progress: 0,
      not_started: 0,
      warnings: lmsItems.reduce((total, item) => total + item.warnings.length, 0),
    },
  };
}
