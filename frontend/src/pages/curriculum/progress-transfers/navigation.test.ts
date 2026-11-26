import { describe, expect, it } from 'vitest';
import { apprenticeNavItems, enrolmentNavItems, curriculumNavItems } from '@/mocks/navigation';
import { ROUTE_PERMISSIONS, NAV_PERMISSIONS } from '@/mocks/rbac';

describe('transfer workspace ownership', () => {
  it('offers Transfer Progress in both enrolment sidebars, not curriculum', () => {
    for (const items of [apprenticeNavItems, enrolmentNavItems]) {
      expect(items.find(item => item.id === 'enrolment-progress-transfers')?.href).toBe('/users/progress-transfers');
    }
    expect(curriculumNavItems.some(item => item.label === 'Transfer Progress')).toBe(false);
  });
  it('retains admin-only access to the entry and both old and new paths', () => {
    for (const path of ['/users/progress-transfers', '/curriculum/progress-transfers']) {
      expect(ROUTE_PERMISSIONS.find(rule => rule.path === path)?.allowedRoles).toEqual(['tenant-admin', 'super-admin']);
    }
    expect(NAV_PERMISSIONS.find(rule => rule.navId === 'enrolment-progress-transfers')?.allowedRoles).toEqual(['tenant-admin', 'super-admin']);
  });
});
