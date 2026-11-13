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
  it('offers exactly two destinations and keeps their existing recording URLs', () => {
    render(<MemoryRouter><RecordingsHub /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Coach Meetings & Recordings/ })).toHaveAttribute('href', '/curriculum/coaching-recordings');
    expect(screen.getByRole('link', { name: /Tutor Session Recordings/ })).toHaveAttribute('href', '/curriculum/recordings');
    const entry = curriculumNavItems.find(item => item.href === '/curriculum/recordings-hub');
    expect(entry?.label).toBe('Coach & Tutor Recordings');
    expect(entry?.matchPaths).toEqual(expect.arrayContaining(['/curriculum/recordings', '/curriculum/coaching-recordings']));
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
