import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { OffScheduleRunDetails } from '../OffScheduleRunDetails';

afterEach(cleanup);
const early = { runStartUtc: '2026-09-09T09:11:00Z', runEndUtc: '2026-09-09T09:12:00Z',
  scheduledStartUtc: '2026-09-09T11:00:00Z', reason: 'before_session' };

describe('off-schedule link-use details', () => {
  it('starts collapsed and retains every reason and exact time when expanded', async () => {
    const runs = [early, { ...early, runStartUtc: '2026-09-10T09:11:00Z', runEndUtc: '2026-09-10T09:12:00Z', reason: 'after_session' },
      { ...early, runStartUtc: '2026-09-09T15:11:00Z', runEndUtc: '2026-09-09T15:12:00Z', reason: 'test_open' }];
    const { container } = render(<OffScheduleRunDetails runs={runs} when={value => value} />);
    const summary = screen.getByText('3 link uses outside this session');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/Teams was opened on this link/)).not.toBeVisible();
    await userEvent.click(summary);
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByText(/Teams was opened on this link/)).toHaveTextContent(early.runStartUtc);
    expect(screen.getByText(/Teams was used on this link/)).toHaveTextContent('more than 12 hours after');
    expect(screen.getByText(/One person opened this link/)).toHaveTextContent('a check of the room');
    expect(screen.getByText(/Its attendance and recordings are kept separately/)).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('does not invent a notice for an empty history and labels a single use', () => {
    const { rerender, container } = render(<OffScheduleRunDetails runs={[]} when={value => value} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OffScheduleRunDetails runs={[early]} when={value => value} />);
    expect(screen.getByText('1 link use outside this session')).toBeVisible();
  });
});
