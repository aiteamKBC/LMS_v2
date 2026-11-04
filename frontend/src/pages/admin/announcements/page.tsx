// ============================================================================
// Announcements — the site-wide banner, authored here
//
// One form (message, background colour, start and end) and the list of every
// banner with its live/scheduled/ended state. A banner shows on every page of
// the LMS, signed in or not, between its start and end; people can close it,
// and it returns on their next visit until the end time passes.
// ============================================================================
import { useCallback, useState, type FormEvent } from 'react';
import { AdminPage, DataPanel, SourceNote, StatusBadge } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { AnnouncementBar } from '@/components/feature/AnnouncementBanner';
import { AppIcon } from '@/components/feature/AppIcon';
import { useToast } from '@/hooks/useToast';
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchAnnouncements,
  updateAnnouncement,
  type AdminAnnouncement,
  type AnnouncementStatus,
} from '@/api/platformAdmin';

const MAX_MESSAGE_LENGTH = 500;
const PRESET_COLORS = ['#1D4ED8', '#047857', '#B45309', '#B91C1C', '#6D28D9', '#334155'];

const STATUS_TONE: Record<AnnouncementStatus, 'ok' | 'warn' | 'neutral'> = {
  live: 'ok',
  scheduled: 'warn',
  ended: 'neutral',
};

interface FormState {
  message: string;
  backgroundColor: string;
  startsAt: string;
  endsAt: string;
}

/** A `datetime-local` value ("YYYY-MM-DDTHH:mm") in the browser's own zone. */
function toLocalInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function emptyForm(): FormState {
  const start = new Date();
  start.setSeconds(0, 0);
  return {
    message: '',
    backgroundColor: PRESET_COLORS[0],
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(new Date(start.getTime() + 24 * 60 * 60_000)),
  };
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

const inputClass = 'w-full px-3 py-2 rounded-xl border border-foreground-200/60 bg-background-50 text-[13px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-200';
const labelClass = 'block text-[11px] font-semibold text-foreground-600 mb-1.5';

export default function AdminAnnouncementsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useAdminData(useCallback(() => fetchAnnouncements(), []));
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const rows = data ?? [];
  const liveCount = rows.filter(r => r.status === 'live').length;
  const scheduledCount = rows.filter(r => r.status === 'scheduled').length;

  const update = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
  };

  const startEdit = (row: AdminAnnouncement) => {
    setEditingId(row.id);
    setConfirmingDelete(null);
    setForm({
      message: row.message,
      backgroundColor: row.backgroundColor,
      startsAt: toLocalInput(new Date(row.startsAt)),
      endsAt: toLocalInput(new Date(row.endsAt)),
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const start = new Date(form.startsAt);
    const end = new Date(form.endsAt);
    if (!form.message.trim()) return toast.error('Enter the announcement message.');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return toast.error('Enter both a start and an end.');
    if (end <= start) return toast.error('The end must be after the start.');

    const input = {
      message: form.message.trim(),
      backgroundColor: form.backgroundColor,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
    setSaving(true);
    try {
      if (editingId === null) {
        await createAnnouncement(input);
        toast.success('Announcement saved');
      } else {
        await updateAnnouncement(editingId, input);
        toast.success('Announcement updated');
      }
      resetForm();
      reload();
    } catch (err) {
      toast.error('Could not save the announcement', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      await deleteAnnouncement(id);
      if (editingId === id) resetForm();
      setConfirmingDelete(null);
      toast.success('Announcement deleted');
      reload();
    } catch (err) {
      toast.error('Could not delete the announcement', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <AdminPage
      title="Announcements"
      subtitle="Banners shown across the whole LMS for a set period"
      icon="ri-megaphone-line"
      heroTitle="Announcements"
      heroBlurb={<>Post a banner at the top of every page — for example, planned downtime. It shows to everyone between its start and end. People can close it, but it comes back on their next visit until the end time.</>}
      stats={[
        { label: 'Live now', value: loading && !data ? '—' : liveCount },
        { label: 'Scheduled', value: loading && !data ? '—' : scheduledCount },
      ]}
    >
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-[var(--kbc-border)] bg-[var(--kbc-surface)] p-4 md:p-5">
        <h2 className="text-sm font-heading font-semibold text-foreground-900">
          {editingId === null ? 'New announcement' : 'Edit announcement'}
        </h2>

        <div>
          <label htmlFor="announcement-message" className={labelClass}>Message</label>
          <textarea
            id="announcement-message"
            value={form.message}
            onChange={e => update({ message: e.target.value })}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={3}
            placeholder="e.g. The LMS will be unavailable on Saturday from 22:00 to 00:00 for maintenance."
            className={`${inputClass} resize-y`}
          />
          <p className="mt-1 text-right text-[10px] text-foreground-400">{form.message.length}/{MAX_MESSAGE_LENGTH}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <span className={labelClass}>Background colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => update({ backgroundColor: color })}
                  aria-label={`Use ${color}`}
                  aria-pressed={form.backgroundColor === color}
                  className={`h-7 w-7 cursor-pointer rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${form.backgroundColor === color ? 'border-foreground-900' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                value={form.backgroundColor}
                onChange={e => update({ backgroundColor: e.target.value.toUpperCase() })}
                aria-label="Custom colour"
                className="h-7 w-10 cursor-pointer rounded border border-foreground-200/60 bg-transparent"
              />
            </div>
          </div>
          <div>
            <label htmlFor="announcement-start" className={labelClass}>Show from</label>
            <input
              id="announcement-start"
              type="datetime-local"
              value={form.startsAt}
              onChange={e => update({ startsAt: e.target.value })}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="announcement-end" className={labelClass}>Show until</label>
            <input
              id="announcement-end"
              type="datetime-local"
              value={form.endsAt}
              min={form.startsAt}
              onChange={e => update({ endsAt: e.target.value })}
              required
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className={labelClass}>Preview</span>
          <div className="overflow-hidden rounded-xl">
            <AnnouncementBar message={form.message || 'Your message will appear here.'} backgroundColor={form.backgroundColor} />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {editingId !== null && (
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="cursor-pointer rounded-xl border border-foreground-200 px-4 py-2 text-xs font-semibold text-foreground-600 transition-smooth hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-xs font-semibold text-white transition-smooth hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <AppIcon className={saving ? 'ri-loader-4-line animate-spin' : 'ri-save-line'} aria-hidden="true" />
            {saving ? 'Saving...' : editingId === null ? 'Publish announcement' : 'Save changes'}
          </button>
        </div>
      </form>

      <DataPanel
        loading={loading && !data}
        error={error}
        empty={rows.length === 0}
        emptyIcon="ri-megaphone-line"
        emptyMessage="No announcements yet."
        onRetry={reload}
      >
        <div className="overflow-hidden rounded-2xl border border-[var(--kbc-border)] bg-[var(--kbc-surface)]">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground-400/50">
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-foreground-400">Message</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-foreground-400">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-foreground-400">From</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-foreground-400">Until</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-foreground-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-background-100/50 transition-smooth hover:bg-primary-50/40">
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.backgroundColor }} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="max-w-[420px] break-words font-medium text-foreground-800 line-clamp-2">{row.message}</p>
                          {row.createdBy && <p className="mt-0.5 text-[10px] text-foreground-400">by {row.createdBy}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={row.status} tone={STATUS_TONE[row.status]} /></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-foreground-500">{fmtDateTime(row.startsAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-foreground-500">{fmtDateTime(row.endsAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {confirmingDelete === row.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(row.id)}
                            disabled={deleting === row.id}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-smooth hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <AppIcon className={deleting === row.id ? 'ri-loader-4-line animate-spin' : 'ri-delete-bin-line'} aria-hidden="true" />
                            {deleting === row.id ? 'Deleting...' : 'Confirm delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(null)}
                            disabled={deleting === row.id}
                            className="cursor-pointer text-[11px] font-semibold text-foreground-400 hover:text-foreground-700 disabled:opacity-60"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700"
                          >
                            <AppIcon className="ri-edit-line" aria-hidden="true" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(row.id)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[11px] font-semibold text-foreground-600 transition-smooth hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                          >
                            <AppIcon className="ri-delete-bin-line" aria-hidden="true" /> Delete
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DataPanel>

      <SourceNote>
        Times are entered in your own time zone. A closed banner stays closed only until the person refreshes or comes
        back, then shows again until its end time. Ended announcements stay listed as a record of what was shown.
      </SourceNote>
    </AdminPage>
  );
}
