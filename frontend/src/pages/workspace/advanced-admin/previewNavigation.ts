import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { learnerNavItems } from '@/mocks/navigation';

const sections: Record<string, string> = {
  'learner-home': 'home', 'learner-overview': 'dashboard',
  'learner-my-learning': 'learning', 'learner-monthly-submission': 'monthly-submission',
  'learner-monthly-logs': 'monthly-logs', 'learner-monthly-coaching': 'monthly-coaching',
  'learner-progress-reviews': 'progress-reviews', 'learner-reviews': 'reviews',
  'learner-attendance': 'attendance', 'learner-evidence': 'evidence',
  'learner-calendar': 'calendar', 'learner-onboarding': 'enrolment',
  'learner-compliance-documents': 'compliance', 'learner-messages': 'messages',
};

export function previewSection(value: string | undefined): string {
  return value && Object.values(sections).includes(value) ? value : 'home';
}

export function previewNavigation(learnerId: number): SidebarNavItem[] {
  const base = `/workspace/advanced-admin/learners/${learnerId}/preview`;
  const convert = (item: SidebarNavItem): SidebarNavItem => ({
    ...item,
    href: sections[item.id] ? `${base}/${sections[item.id]}` : undefined,
    matchPaths: undefined,
    badge: undefined,
    children: item.children?.map(convert),
  });
  return [
    { id: 'advanced-admin-record', label: 'Learner record', icon: 'ri-arrow-left-line', href: `/workspace/advanced-admin/learners/${learnerId}/learning` },
    ...learnerNavItems.map(convert),
  ];
}
