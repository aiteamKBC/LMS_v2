import { describe, expect, it } from 'vitest';

import type { SidebarNavItem } from '@/components/feature/Sidebar';
import { coachNavItems, employerNavItems } from './navigation';

function findItem(items: SidebarNavItem[], id: string): SidebarNavItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;

    const child = findItem(item.children ?? [], id);
    if (child) return child;
  }

  return undefined;
}

describe('role notification navigation', () => {
  it('gives coaches a direct link to notifications', () => {
    expect(findItem(coachNavItems, 'coach-notifications')).toMatchObject({
      label: 'Notifications',
      href: '/notifications',
    });
  });

  it('gives employers a notifications link in their communication section', () => {
    const communication = findItem(employerNavItems, 'employer-group-communication');

    expect(communication?.children?.map((item) => item.id)).toContain('employer-notifications');
    expect(findItem(employerNavItems, 'employer-notifications')).toMatchObject({
      label: 'Notifications',
      href: '/notifications',
    });
  });
});
