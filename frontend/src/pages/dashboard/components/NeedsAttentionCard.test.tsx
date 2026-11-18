import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HeaderNotification } from '@/components/feature/Header';
import NeedsAttentionCard from './NeedsAttentionCard';

afterEach(cleanup);

const notification: HeaderNotification = {
  id: 'synthetic-alert-1',
  title: 'Synthetic learner · Red feedback',
  description: 'The session notes need review.',
  meta: 'Learner · Synthetic coach · Session notes',
  tone: 'red',
};

describe('Quality dashboard needs attention', () => {
  it('starts as a compact button, fetches on opening and hides the list on closing', async () => {
    const refresh = vi.fn();
    render(<NeedsAttentionCard notifications={[notification]} onNotificationClick={vi.fn()} onRefresh={refresh} />);
    const toggle = screen.getByRole('button', { name: 'Needs Attention' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Needs Attention' })).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Needs Attention' })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Needs Attention' })).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('shows the supplied notification details and opens the selected alert', async () => {
    const onNotificationClick = vi.fn();
    render(<NeedsAttentionCard notifications={[notification]} onNotificationClick={onNotificationClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Needs Attention' }));
    const card = within(screen.getByRole('region', { name: 'Needs Attention' }));
    expect(card.getByText('1 alert')).toBeInTheDocument();
    expect(card.getByText(notification.description)).toBeInTheDocument();
    expect(card.getByText(notification.meta!)).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: /Synthetic learner/ }));
    expect(onNotificationClick).toHaveBeenCalledExactlyOnceWith(notification);
  });

  it('updates the count and list when the notification source changes', async () => {
    const second = { ...notification, id: 'synthetic-alert-2', title: 'Another quality alert', meta: undefined };
    const { rerender } = render(<NeedsAttentionCard notifications={[notification]} onNotificationClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Needs Attention' }));
    rerender(<NeedsAttentionCard notifications={[notification, second]} onNotificationClick={vi.fn()} />);
    expect(screen.getByText('2 alerts')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Another quality alert/ })).toBeInTheDocument();
  });

  it('shows an empty state when there are no notifications', async () => {
    render(<NeedsAttentionCard notifications={[]} onNotificationClick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Needs Attention' }));
    expect(screen.getByText('0 alerts')).toBeInTheDocument();
    expect(screen.getByText('No quality alerts need your attention.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Needs Attention' })).queryByRole('button')).not.toBeInTheDocument();
  });

  it('distinguishes loading and failed requests from an empty alert list and allows retry', async () => {
    const refresh = vi.fn();
    const { rerender } = render(<NeedsAttentionCard notifications={[]} onNotificationClick={vi.fn()} loading onRefresh={refresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Needs Attention' }));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading quality alerts');
    expect(screen.queryByText('0 alerts')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh alerts' })).toBeDisabled();
    rerender(<NeedsAttentionCard notifications={[]} onNotificationClick={vi.fn()} error="Could not load alerts" onRefresh={refresh} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load alerts');
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No quality alerts need your attention.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh alerts' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
