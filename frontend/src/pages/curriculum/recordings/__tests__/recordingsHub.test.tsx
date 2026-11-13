import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import RecordingsHub from '../RecordingsHub';
import { curriculumNavItems } from '@/mocks/navigation';
import { CurriculumDeliveryHub } from '../../hubs/page';

vi.mock('@/components/feature/WorkspaceShell', () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useCurriculumData', () => ({ useCurriculumData: () => ({ data: {}, loading: false, error: '' }) }));
vi.mock('@/hooks/useCurriculumProgrammes', () => ({ useCurriculumProgrammes: () => ({ programmes: [], loading: false, error: '' }) }));

describe('Coach and tutor recordings entry points', () => {
  it('offers exactly two destinations and keeps their existing recording URLs', () => {
    render(<MemoryRouter><RecordingsHub /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Coach Meetings & Recordings/ })).toHaveAttribute('href', '/curriculum/coaching-recordings');
    expect(screen.getByRole('link', { name: /Tutor Session Recordings/ })).toHaveAttribute('href', '/curriculum/recordings');
  });
  it('keeps all recording destinations in the existing permissioned sidebar group', () => {
    const entry = curriculumNavItems.find(item => item.id === 'curriculum-coaching-recordings');
    expect(entry?.label).toBe('Recordings');
    expect(entry?.children?.map(({ id, label, href }) => ({ id, label, href }))).toEqual([
      { id: 'curriculum-recordings-hub', label: 'Recordings hub', href: '/curriculum/recordings-hub' },
      { id: 'curriculum-tutor-recordings', label: 'Tutor session recordings', href: '/curriculum/recordings' },
      { id: 'curriculum-coach-meetings', label: 'Coach meetings', href: '/curriculum/coaching-recordings' },
    ]);
    expect(curriculumNavItems.find(item => item.href === '/curriculum/delivery')?.matchPaths).not.toContain('/curriculum/recordings');
  });
  it('removes the recording shortcuts from Delivery and preserves its scheduling destinations', () => {
    const { container } = render(<MemoryRouter><CurriculumDeliveryHub /></MemoryRouter>);
    const links = within(container).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).not.toContain('/curriculum/recordings');
    expect(links.map(link => link.getAttribute('href'))).not.toContain('/curriculum/coaching-recordings');
    expect(links.map(link => link.getAttribute('href'))).toEqual(expect.arrayContaining(['/curriculum/teams-meetings', '/curriculum/session-calendar']));
  });
});
