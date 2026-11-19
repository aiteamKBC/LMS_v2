import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import type { KsbImportPreview, KsbImportPreviewRow } from './ksbExcel';

function componentLabel(week: string, weekTitle: string, title: string, type: string): string {
  return [week ? `Week ${week}` : '', weekTitle, title, type].filter(Boolean).join(' / ') || 'Not supplied';
}

const matchLabels: Record<KsbImportPreviewRow['status'], string> = {
  id: 'Component ID matches',
  suggested: 'Suggested: week, title and type match',
  ambiguous: 'Skipped: more than one possible match or duplicate row',
  unmatched: 'Skipped: no matching component',
};

/** Spreadsheet values are inserted as text, never interpreted as HTML. */
export async function reviewKsbImport(preview: KsbImportPreview): Promise<boolean> {
  const matched = preview.rows.filter(row => row.status === 'id' || row.status === 'suggested').length;
  const suggested = preview.rows.filter(row => row.status === 'suggested').length;
  const content = document.createElement('div');
  const explanation = document.createElement('p');
  explanation.textContent = `Rows to apply: ${matched}. Suggested matches: ${suggested}. Rows to skip: ${preview.rows.length - matched}. Review each destination and its new KSBs. Applying replaces the current KSBs on matched components; skipped components stay unchanged. Cancel leaves everything unchanged.`;
  content.append(explanation);

  if (preview.skippedTokens.length) {
    const warning = document.createElement('p');
    warning.className = 'mt-2 text-amber-700';
    warning.textContent = `Ignored codes: ${preview.skippedTokens.join(', ')}. A matched row with no valid codes will clear its current KSBs.`;
    content.append(warning);
  }

  const scroll = document.createElement('div');
  scroll.className = 'mt-4 max-h-[50vh] overflow-auto text-left';
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'KSB import matches');
  const table = document.createElement('table');
  table.className = 'w-full min-w-[680px] border-collapse text-xs';
  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = 'Proposed KSB changes and skipped spreadsheet rows';
  table.append(caption);
  const header = table.createTHead().insertRow();
  for (const label of ['Sheet row', 'From the sheet', 'Destination', 'Current KSBs', 'New KSBs', 'Result']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.className = 'border-b p-2 align-top';
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const row of preview.rows) {
    const target = row.target;
    const values = [
      String(row.rowNumber),
      componentLabel(row.weekNumber, row.weekTitle, row.title, row.type),
      target ? componentLabel(target.weekNumber, target.weekTitle, target.title, target.type) : 'No changes',
      target?.currentKsbs || '—',
      row.ksbs.map(item => `${item.code}:${item.type}:${item.weight}`).join(', ') || (target ? 'Clear current KSBs' : 'No valid codes'),
      matchLabels[row.status],
    ];
    const tr = body.insertRow();
    for (const value of values) {
      const cell = tr.insertCell();
      cell.className = 'border-b p-2 align-top break-words';
      cell.textContent = value;
    }
  }
  scroll.append(table);
  content.append(scroll);

  const result = await Swal.fire({
    title: matched ? 'Review KSB import' : 'No matching components',
    html: content,
    icon: 'warning',
    width: 1000,
    showCancelButton: true,
    showConfirmButton: matched > 0,
    confirmButtonText: `Apply ${matched} matched row${matched === 1 ? '' : 's'}`,
    cancelButtonText: matched ? 'Cancel' : 'Close',
    focusCancel: true,
    reverseButtons: true,
    buttonsStyling: false,
    customClass: {
      popup: 'kbc-standard-swal-popup',
      title: 'kbc-standard-swal-title',
      htmlContainer: 'kbc-standard-swal-text !max-w-none w-full min-w-0 !text-sm',
      actions: 'kbc-standard-swal-actions',
      confirmButton: 'kbc-standard-swal-confirm',
      cancelButton: 'kbc-standard-swal-cancel',
    },
  });
  return result.isConfirmed;
}
