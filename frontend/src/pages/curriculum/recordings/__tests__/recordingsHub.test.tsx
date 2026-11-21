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
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ auth: { account: { id: -1, role: 'staff', access: 'curriculum' }, tenant: null } }) }));
vi.mock('../../hubs/useDeliverySessions', () => ({ useDeliverySessions: () => ({ sessions: [], loading: false, error: null }) }));
vi.mock('../../hubs/useDeliveryData', () => ({ useDeliveryOverview: () => ({ data: null, loading: false, error: null }) }));

describe('Coach and tutor recordings entry points', () => {
  it('offers recording and quality destinations with their existing URLs', () => {
    render(<MemoryRouter><RecordingsHub /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /Coach Meetings & Recordings/ })).toHaveAttribute('href', '/curriculum/coaching-recordings');
    expect(screen.getByRole('link', { name: /Tutor Session Recordings/ })).toHaveAttribute('href', '/curriculum/recordings');
    expect(screen.getByRole('link', { name: /Quality Assurance/ })).toHaveAttribute('href', '/curriculum/quality-demo');
  });
  it('uses the same quality destination from its card and the curriculum sidebar', () => {
    render(<MemoryRouter><RecordingsHub /></MemoryRouter>);
    const card = screen.getByRole('link', { name: 'Quality Assurance' });
    const recordings = curriculumNavItems.find(item => item.id === 'curriculum-coaching-recordings');
    const entry = recordings?.children?.find(item => item.id === 'curriculum-quality-assurance');
    expect(entry?.href).toBe(card.getAttribute('href'));
    expect(entry?.children).toBeUndefined();
    expect(curriculumNavItems.some(item => item.id === 'curriculum-quality-assurance')).toBe(false);
    expect(card.querySelector('img')).toHaveAttribute('src', '/recordings-hub/quality.svg');
  });
  it('keeps all recording destinations in the existing permissioned sidebar group', () => {
    const entry = curriculumNavItems.find(item => item.id === 'curriculum-coaching-recordings');
    expect(entry?.label).toBe('Recording Quality');
    expect(entry?.href).toBe('/curriculum/recordings-hub');
    expect(entry?.overviewPermissionId).toBe('curriculum-recordings-hub');
    expect(entry?.children?.map(({ id, label, href }) => ({ id, label, href }))).toEqual([
      { id: 'curriculum-tutor-recordings', label: 'Tutor session recordings', href: '/curriculum/recordings' },
      { id: 'curriculum-coach-meetings', label: 'Coach meetings', href: '/curriculum/coaching-recordings' },
      { id: 'curriculum-quality-assurance', label: 'Quality Assurance', href: '/curriculum/quality-demo' },
      { id: 'curriculum-quality-checks', label: 'Quality Checks', href: '/curriculum/coaching-recordings/reviews' },
      { id: 'curriculum-quality-deep-dive', label: 'Deep Dive', href: '/curriculum/quality-demo?view=deep-dive' },
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
