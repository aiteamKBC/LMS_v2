import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Swal from 'sweetalert2';
import { reviewKsbImport } from '../ksbImportReview';
import type { KsbImportPreview } from '../ksbExcel';

function preview(): KsbImportPreview {
  return {
    skippedTokens: [],
    rows: [{
      rowNumber: 2, sourceId: 'SOURCE', weekNumber: '1', weekTitle: 'Introduction',
      title: 'Reading task', type: 'reading', ksbs: [{ code: 'K1', type: 'main', weight: 40 }],
      status: 'suggested',
      target: {
        componentId: 'DESTINATION', weekNumber: '1', weekTitle: 'Introduction',
        title: 'Reading task', type: 'reading', currentKsbs: 'S2:secondary:20',
      },
    }, {
      rowNumber: 3, sourceId: 'DUPLICATE', weekNumber: '1', weekTitle: 'Introduction',
      title: 'Repeated title', type: 'video', ksbs: [{ code: 'B1', type: 'main', weight: 40 }],
      status: 'ambiguous',
    }],
  };
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  // jsdom has no layout. SweetAlert focuses only buttons with visible dimensions.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.style.display === 'none' ? 0 : 100;
  });
});
afterEach(() => { Swal.close(); vi.restoreAllMocks(); });

describe('KSB import review dialog', () => {
  it('shows destinations, current/new codes and skipped rows, and waits for confirmation', async () => {
    let resolved = false;
    const result = reviewKsbImport(preview()).then(value => { resolved = true; return value; });
    const dialog = await screen.findByRole('dialog', { name: 'Review KSB import' });
    expect(within(dialog).getByRole('table')).toBeInTheDocument();
    expect(within(dialog).getByText('S2:secondary:20')).toBeInTheDocument();
    expect(within(dialog).getByText('K1:main:40')).toBeInTheDocument();
    expect(within(dialog).getByText(/Skipped: more than one possible match/)).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'KSB import matches' })).toHaveAttribute('tabindex', '0');
    expect(resolved).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply 1 matched row' }));
    expect(await result).toBe(true);
  });

  it('cancels without approving any changes', async () => {
    const result = reviewKsbImport(preview());
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.click(cancel);
    expect(await result).toBe(false);
  });

  it('shows a warning with no apply action when all rows are unresolved', async () => {
    const value = preview();
    value.rows = [value.rows[1]];
    const result = reviewKsbImport(value);
    const dialog = await screen.findByRole('dialog', { name: 'No matching components' });
    expect(within(dialog).queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
    expect(dialog.querySelector('.swal2-warning')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await result).toBe(false);
  });

  it('renders spreadsheet text safely and makes invalid-code clearing visible', async () => {
    const value = preview();
    value.rows[0].title = '<img src=x onerror=alert(1)>';
    value.rows[0].ksbs = [];
    value.skippedTokens = ['K99 (not in selected KSB source)'];
    const result = reviewKsbImport(value);
    const dialog = await screen.findByRole('dialog', { name: 'Review KSB import' });
    expect(within(dialog).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(dialog.querySelector('img[src="x"]')).toBeNull();
    expect(within(dialog).getByText('Clear current KSBs')).toBeInTheDocument();
    expect(within(dialog).getByText(/K99.*clear its current KSBs/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await result).toBe(false);
  });
});
