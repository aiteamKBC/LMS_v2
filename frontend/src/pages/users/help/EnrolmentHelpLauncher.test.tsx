import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnrolmentHelpLauncher } from './EnrolmentHelpLauncher';

afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('floating Enrolment help launcher', () => {
  it('offers the guide from both the button and the English message', () => {
    const onOpen = vi.fn();
    render(<EnrolmentHelpLauncher title="User Management" onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Watch User Management page guide' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Need help on this page? Click here' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('hides only the message for this tab session and keeps the button', () => {
    const { unmount } = render(<EnrolmentHelpLauncher title="User Management" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide help message' }));
    expect(screen.queryByText('Need help on this page? Click here')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Watch User Management page guide' })).toBeVisible();
    unmount();
    render(<EnrolmentHelpLauncher title="Coach Directory" onOpen={vi.fn()} />);
    expect(screen.queryByText('Need help on this page? Click here')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Watch Coach Directory page guide' })).toBeVisible();
  });

  it('still shows the message when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<EnrolmentHelpLauncher title="User Management" onOpen={vi.fn()} />);
    expect(screen.getByText('Need help on this page? Click here')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Hide help message' }));
    expect(screen.queryByText('Need help on this page? Click here')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
