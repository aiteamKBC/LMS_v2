import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { UserListRow } from '../types';
import type { DirectoryAttendanceModes } from '../exportDirectory';

export function ExportDirectoryButton({ rows, attendanceModes, disabled }: {
  rows: UserListRow[];
  attendanceModes: DirectoryAttendanceModes;
  disabled: boolean;
}) {
  const busy = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const unavailable = disabled || rows.length === 0 || attendanceModes === null;

  const download = async () => {
    if (busy.current || unavailable) return;
    busy.current = true;
    setExporting(true);
    setError('');
    try {
      const { createDirectoryWorkbook } = await import('../exportDirectory');
      const blob = new Blob([createDirectoryWorkbook(rows, attendanceModes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = 'enrolment-users.xlsx';
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError('Could not export users. Please try again.');
    } finally {
      busy.current = false;
      setExporting(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={download} disabled={unavailable || exporting}
        title="Export all filtered users to Excel (.xlsx)"
        className="inline-flex items-center gap-1.5 rounded-lg border border-foreground-100 px-3 py-2 text-[12px] font-medium text-foreground-600 transition hover:border-primary-200 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
        <Upload size={14} aria-hidden="true" />{exporting ? 'Exporting...' : 'Export'}
      </button>
      {error && <p role="alert" className="mt-1 max-w-xs text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
