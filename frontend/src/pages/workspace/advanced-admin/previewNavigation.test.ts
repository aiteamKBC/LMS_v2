import { describe, expect, it } from 'vitest';
import { previewNavigation, previewSection } from './previewNavigation';

describe('advanced admin read-only learner navigation', () => {
  it('keeps every learner menu destination inside one scoped preview', () => {
    const nav = previewNavigation(42);
    const leaves = nav.flatMap(item => item.children || [item]).filter(item => item.id !== 'advanced-admin-record');
    expect(leaves).toHaveLength(14);
    expect(leaves.every(item => item.href?.startsWith('/workspace/advanced-admin/learners/42/preview/'))).toBe(true);
    expect(leaves.find(item => item.id === 'learner-messages')?.href).toContain('/preview/messages');
    expect(leaves.find(item => item.id === 'learner-onboarding')?.href).toContain('/preview/enrolment');
    expect(previewSection('unknown')).toBe('home');
  });
});
