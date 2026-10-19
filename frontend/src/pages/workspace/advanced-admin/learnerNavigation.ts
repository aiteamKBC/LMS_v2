import type { SidebarNavItem } from '@/components/feature/Sidebar';
import type { RecordTab } from './ReviewSections';

export type LearnerSection = 'learning' | Exclude<RecordTab, 'evidence' | 'monthly'>;

export const sections: Record<LearnerSection, { title: string; description: string; icon: string }> = {
  learning: { title: 'Learning & progress', description: 'Courses, activities and completion', icon: 'ri-book-open-line' },
  assessments: { title: 'Assignments & Marking', description: 'Assigned work, submissions and decisions', icon: 'ri-clipboard-line' },
  lectures: { title: 'Lectures & attendance', description: 'Attendance and quality by date', icon: 'ri-calendar-check-line' },
  reviews: { title: 'PR & MCM', description: 'Reviews and existing AI reports', icon: 'ri-file-copy-line' },
  eligibility: { title: 'Eligibility Review', description: 'Eligibility records and outcomes', icon: 'ri-list-check-line' },
  inclusion: { title: 'Inclusion & support', description: 'Reports, action plans and notes', icon: 'ri-heart-pulse-line' },
};

export const sectionOrder: LearnerSection[] = [
  'learning', 'assessments', 'lectures', 'reviews', 'eligibility', 'inclusion',
];

export const isLearnerSection = (value: string | null | undefined): value is LearnerSection =>
  value != null && Object.prototype.hasOwnProperty.call(sections, value);

export const learnerSectionHref = (learnerId: number, section: LearnerSection) =>
  `/workspace/advanced-admin/learners/${learnerId}/${section}`;

export function learnerNavigation(learnerId: number): SidebarNavItem[] {
  return sectionOrder.map(section => ({
    id: `advanced-admin-${section}`,
    label: sections[section].title,
    href: learnerSectionHref(learnerId, section),
    icon: sections[section].icon,
  }));
}
