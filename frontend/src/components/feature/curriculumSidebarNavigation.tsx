import { Archive, ArrowLeftRight, BookOpen, CalendarCheck, CalendarDays, Film, FolderOpen, GraduationCap, Home, Layers, LayoutGrid, ShieldCheck, Users } from 'lucide-react';
import type { SidebarNavItem } from '@/components/feature/Sidebar';
import type { SidebarNavigationPresentation } from '@/components/feature/SidebarNavigationContext';
import { roleNavMap } from '@/mocks/navigation';
import styles from './curriculumSidebarNavigation.module.css';

export function curriculumNavigation(permittedItems: SidebarNavItem[]): SidebarNavItem[] {
  const find = (id: string) => permittedItems.find(item => item.id === id);
  const delivery = find('curriculum-delivery');
  const builder: SidebarNavItem | undefined = delivery && {
    id: 'curriculum-module-builder', label: 'Module Builder', icon: 'ri-layout-4-line',
    children: [
      { id: 'curriculum-modules', label: 'Modules', href: '/curriculum/module-builder', matchPaths: ['/curriculum/modules'], icon: 'ri-layout-4-line' },
      { id: 'curriculum-recordings', label: 'Session recordings', href: '/curriculum/recordings', icon: 'ri-film-line' },
      { id: 'curriculum-bank-holidays', label: 'Bank holidays', href: '/curriculum/england-holidays', icon: 'ri-calendar-line' },
    ].map(child => ({ ...child, locked: delivery.locked, lockedReason: delivery.lockedReason, comingSoon: delivery.comingSoon })),
  };
  const ordered = [find('curriculum-home'), find('curriculum-programmes'), builder, find('curriculum-courses'), find('curriculum-library'), find('curriculum-quality'), find('curriculum-bulk-attendance'), find('curriculum-archive')]
    .filter((item): item is SidebarNavItem => Boolean(item));
  const usedIds = new Set(ordered.map(item => item.id));
  usedIds.add('curriculum-delivery');
  const additional = permittedItems.filter(item => !usedIds.has(item.id));
  return additional.length ? [...ordered, { id: 'curriculum-home-additional-tools', label: 'Additional tools', icon: 'ri-folder-open-line', children: additional }] : ordered;
}

const icons: Record<string, typeof Home> = {
  'curriculum-home': Home,
  'curriculum-programmes': Layers,
  'curriculum-module-builder': LayoutGrid,
  'curriculum-modules': LayoutGrid,
  'curriculum-recordings': Film,
  'curriculum-bank-holidays': CalendarDays,
  'curriculum-library': FolderOpen,
  'curriculum-courses': GraduationCap,
  'curriculum-quality': ShieldCheck,
  'curriculum-bulk-attendance': CalendarCheck,
  'curriculum-archive': Archive,
  'curriculum-home-additional-tools': FolderOpen,
  'curriculumNavItems-coach-directory': Users,
  'curriculum-progress-transfers': ArrowLeftRight,
};

export const curriculumSidebar: SidebarNavigationPresentation = {
  className: styles.navigation,
  expandedStorageKey: 'kbc_curriculum_home_sidebar_expanded',
  mapItems: curriculumNavigation,
  // A getter, so the label is read when the sidebar renders rather than when
  // this module is imported.
  get header() {
    return <div className={styles.workspaceCard}>
      <LayoutGrid size={15} aria-hidden="true" />
      <span><span className={styles.workspaceEyebrow}>Workspace</span><span className={styles.workspaceName}>{roleNavMap.curriculum.workspaceLabel}</span></span>
    </div>;
  },
  renderIcon: item => {
    const Icon = icons[item.id] ?? BookOpen;
    return <Icon size={17} strokeWidth={1.8} aria-hidden="true" />;
  },
};
