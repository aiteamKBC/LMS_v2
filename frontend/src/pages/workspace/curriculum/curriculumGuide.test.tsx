import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./useCurriculumHome', () => ({
  useCurriculumHome: () => ({
    data: { stats: { programmes: 0, activeCohorts: 0, groups: 0, openIssues: 0 }, attentionCounts: {}, continueModules: [], programmeFocus: [] },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

import CurriculumStudio from './page';

describe('Curriculum Home guide', () => {
  it('explains the complete flow and links material authoring to Module Builder', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CurriculumStudio />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'How to build a programme' }));

    expect(screen.getByRole('dialog', { name: 'Build a programme without getting lost' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 6')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Step 5: Add materials' }));

    expect(screen.getByRole('heading', { name: 'Add content, materials and KSBs' })).toBeTruthy();
    expect(screen.getByText(/upload a PowerPoint or PDF up to 5 MB/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Add learning content/i }).getAttribute('href')).toBe('/curriculum/module-builder');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
