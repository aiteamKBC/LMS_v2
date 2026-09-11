/**
 * Choosing which workspace a multi-access staff member lands in.
 *
 * The radio for this sits inside the <label> whose control is the access
 * checkbox above it, so a click on the radio also reaches the label. The first
 * attempt at containing that used preventDefault, which stopped the checkbox
 * toggling but also cancelled the radio's own selection — clicking "Land here
 * instead" appeared to do nothing at all.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessPanel } from './AccessPanel';
import type { PlatformAccount } from '@/api/platformAdmin';

vi.mock('@/api/staffUsers', async () => {
  const actual = await vi.importActual<typeof import('@/api/staffUsers')>('@/api/staffUsers');
  return { ...actual, updateStaffUser: vi.fn().mockResolvedValue({}) };
});

function account(overrides: Partial<PlatformAccount> = {}): PlatformAccount {
  return {
    id: 1,
    displayName: 'Test Test',
    email: 'test.test@kentbusinesscollege.com',
    access: 'coach',
    accesses: ['coach', 'tutor', 'curriculum'],
    // Access levels apply to staff only — without this the panel renders its
    // "permissions come from their own record" branch and no radios at all.
    subjectType: 'staff',
    subjectId: 42,
    ...overrides,
  } as PlatformAccount;
}

function landingRadios() {
  return screen.getAllByRole('radio');
}

describe('AccessPanel landing page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the current landing page as selected', () => {
    render(<AccessPanel account={account()} isSelf={false} onClose={() => {}} onSaved={() => {}} />);

    const checked = landingRadios().filter(radio => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
  });

  it('moves the selection when another landing page is chosen', async () => {
    // The reported bug: the dot never moved.
    render(<AccessPanel account={account()} isSelf={false} onClose={() => {}} onSaved={() => {}} />);
    const radios = landingRadios();
    const unselected = radios.find(radio => !(radio as HTMLInputElement).checked)!;

    await userEvent.click(unselected);

    expect((unselected as HTMLInputElement).checked).toBe(true);
  });

  it('keeps exactly one landing page selected after a change', async () => {
    render(<AccessPanel account={account()} isSelf={false} onClose={() => {}} onSaved={() => {}} />);
    const unselected = landingRadios().find(radio => !(radio as HTMLInputElement).checked)!;

    await userEvent.click(unselected);

    const checked = landingRadios().filter(radio => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
  });

  it('does not revoke the access grant when its landing radio is clicked', async () => {
    // The reason preventDefault was there: the radio is inside the label whose
    // control is the access checkbox, so the click must not reach it.
    render(<AccessPanel account={account()} isSelf={false} onClose={() => {}} onSaved={() => {}} />);
    const checkboxesBefore = screen.getAllByRole('checkbox')
      .filter(box => (box as HTMLInputElement).checked).length;

    const unselected = landingRadios().find(radio => !(radio as HTMLInputElement).checked)!;
    await userEvent.click(unselected);

    const checkboxesAfter = screen.getAllByRole('checkbox')
      .filter(box => (box as HTMLInputElement).checked).length;
    expect(checkboxesAfter).toBe(checkboxesBefore);
  });

  it('offers no landing choice when only one access is held', () => {
    // Nothing to choose between, so the radios are not rendered at all.
    render(
      <AccessPanel
        account={account({ access: 'coach', accesses: ['coach'] })}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('AccessPanel reports what it saved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands back every grant, not just the landing page', async () => {
    // The caller patches its row from this, and the panel seeds its ticks from
    // that row next time it opens. Reporting only the primary left the row
    // claiming a single grant, so a second access saved correctly on the
    // server and then looked as though it had been dropped.
    const saved = vi.fn();
    render(
      <AccessPanel
        account={account({ access: 'coach', accesses: ['coach'] })}
        isSelf={false}
        onClose={() => {}}
        onSaved={saved}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /curriculum access/i }));
    await userEvent.click(screen.getByRole('button', { name: /save access/i }));

    expect(saved).toHaveBeenCalledTimes(1);
    const [primary, accesses] = saved.mock.calls[0];
    expect(primary).toBe('coach');
    expect([...(accesses as string[])].sort()).toEqual(['coach', 'curriculum']);
  });

  it('sends the whole set to the server', async () => {
    const { updateStaffUser } = await import('@/api/staffUsers');
    render(
      <AccessPanel
        account={account({ access: 'coach', accesses: ['coach'] })}
        isSelf={false}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /curriculum access/i }));
    await userEvent.click(screen.getByRole('button', { name: /save access/i }));

    expect(updateStaffUser).toHaveBeenCalledTimes(1);
    const [, patch] = (updateStaffUser as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([...patch.accesses].sort()).toEqual(['coach', 'curriculum']);
    expect(patch.access).toBe('coach');
  });
});
