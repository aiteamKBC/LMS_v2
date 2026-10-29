import { useEffect, useRef, useState } from 'react';
import {
  readImportedMeetingEditor, previewImportedMeetingEdit, confirmImportedMeetingEdit, checkImportedMeetingEdit,
  type ImportedMeetingEditor as EditorData, type ImportedMeetingEdits, type ImportedCalendarPreview,
} from '@/lib/curriculumApi';
import { zonedNaiveToUtcIso } from '../module-builder/moduleAuthoringData';
import { emailList } from '../module-builder/EmailChipsInput.helpers';
import { naiveLocalFromUtc as localTime } from './createCalendarForm.helpers';
import { TeamsPeopleFields, TeamsMeetingOptionFields,
  type TeamsCalendarForm } from './createCalendarForm';
import { EntraPeopleInput } from './EntraPeopleInput';
import { FormField } from '../shared/entities/ui';

/** Reads the organiser's original calendar before exposing any imported edit. */
export function ImportedMeetingEditor({ liveSessionId, disabled, onUpdated, onEditingChange, onConnectionRequired }: {
  liveSessionId: string; disabled: boolean; onUpdated: () => Promise<void>;
  onEditingChange?: (dirty: boolean, busy: boolean) => void;
  onConnectionRequired?: (kind: 'user' | 'group' | null) => void;
}) {
  const [data, setData] = useState<EditorData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [times, setTimes] = useState<Record<number, string>>({});
  const [review, setReview] = useState<ImportedCalendarPreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const active = useRef(false);
  const inFlight = useRef(false);
  const operation = useRef<string | undefined>(undefined);
  const dirty = data?.status === 'editable' && (
    (['attendees', 'presenters', 'coOrganizers'] as const).some(key =>
      JSON.stringify([...new Set(emailList(form[key] || '').map(value => value.toLowerCase()))].sort())
        !== JSON.stringify([...(data[key] || [])].map(value => value.toLowerCase()).sort()))
    || (data.options && (form.recording !== (data.options.recordAutomatically ? data.options.allowTranscription ? 'record-transcribe' : 'record' : 'none')
      || form.lobby !== (data.options.lobbyBypassSettings?.scope || '') || form.language !== (data.options.meetingSpokenLanguageTag || '')))
    || (data.sessions || []).some(session => times[session.sessionNumber] && times[session.sessionNumber] !== localTime(session.start, data.timeZone || 'Europe/London')));
  useEffect(() => { onEditingChange?.(Boolean(dirty), busy); }, [dirty, busy, onEditingChange]);
  useEffect(() => () => { onEditingChange?.(false, false); }, [onEditingChange]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = async (task: () => Promise<void>, saving = false) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await task(); }
    catch (failure) {
      if (active.current) {
        if (saving) { setUncertain(true); setReview(null); }
        setError(saving ? 'The save result is unavailable. Check edit status before trying another save.'
          : failure instanceof Error ? failure.message : 'The original meeting could not be read. Retry.');
      }
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const load = () => run(async () => {
    const value = await readImportedMeetingEditor(liveSessionId);
    if (!active.current) return;
    setData(value); setMessage(value.message); setReview(null);
    onConnectionRequired?.(value.connectionRequired ? value.connectionKind || 'user' : null);
    operation.current = value.operationId;
    setUncertain(value.status === 'verification_pending');
    if (value.status === 'editable') {
      setForm({ attendees: (value.attendees || []).join('\n'), presenters: (value.presenters || []).join('\n'),
        coOrganizers: (value.coOrganizers || []).join('\n'),
        recording: value.options?.recordAutomatically ? value.options.allowTranscription ? 'record-transcribe' : 'record' : 'none',
        lobby: value.options?.lobbyBypassSettings?.scope || '', language: value.options?.meetingSpokenLanguageTag || '' });
      setTimes({});
    }
  });
  const prepare = (notify: boolean) => run(async () => {
    if (!data?.sourceToken) return;
    const changes: ImportedMeetingEdits = {};
    for (const key of ['attendees', 'presenters', 'coOrganizers'] as const) {
      const next = [...new Set(emailList(form[key] || '').map(value => value.toLowerCase()))];
      if (JSON.stringify([...next].sort()) !== JSON.stringify([...(data[key] || [])].map(value => value.toLowerCase()).sort())) changes[key] = next;
    }
    if (data.options) {
      const original = { recording: data.options.recordAutomatically ? data.options.allowTranscription ? 'record-transcribe' : 'record' : 'none',
        lobby: data.options.lobbyBypassSettings?.scope || '', language: data.options.meetingSpokenLanguageTag || '' };
      for (const key of ['recording', 'lobby', 'language'] as const) if (form[key] !== original[key]) changes[key] = form[key];
    }
    const zone = data.timeZone || 'Europe/London';
    changes.sessions = (data.sessions || []).filter(session => times[session.sessionNumber]
      && times[session.sessionNumber] !== localTime(session.start, zone)).map(session => ({
        sessionNumber: session.sessionNumber, start: zonedNaiveToUtcIso(times[session.sessionNumber], zone),
        durationMinutes: Math.round((Date.parse(session.end) - Date.parse(session.start)) / 60000),
      }));
    if (!changes.sessions.length) delete changes.sessions;
    const result = await previewImportedMeetingEdit(liveSessionId, data.sourceToken, changes, notify);
    if (!active.current) return;
    operation.current = result.operationId; setReview(result); setMessage(result.message); setAcknowledged(false);
    setUncertain(result.status === 'verification_pending');
  });
  const complete = async (status: string, text: string) => {
    if (!active.current) return;
    setMessage(text); setReview(null); setUncertain(status === 'verification_pending');
    if (status === 'confirmed') {
      setData(null); setForm({}); setTimes({});
      try { await onUpdated(); }
      catch { if (active.current) setError('The edit was confirmed. Reopen this module to refresh its displayed data.'); }
    }
  };
  const confirm = () => run(async () => {
    if (!review?.previewToken || !acknowledged) return;
    const result = await confirmImportedMeetingEdit(liveSessionId, review.previewToken);
    operation.current = result.operationId;
    await complete(result.status, result.message);
  }, true);
  const check = () => run(async () => {
    const result = await checkImportedMeetingEdit(liveSessionId, operation.current);
    await complete(result.status, result.message);
  });
  const locked = disabled || busy || uncertain || review?.status === 'ready';
  const editable = data?.status === 'editable';
  // Reuse the existing calendar editor's fields and choices from before the
  // imported-calendar restriction, rather than maintaining another form UI.
  const calendarForm = { attendees: form.attendees || '', presenters: form.presenters || '', coOrganizers: form.coOrganizers || '',
    recording: form.recording || 'none', lobbyBypass: form.lobby === 'organizationExcludingGuests' ? 'organization-excluding-guests' : form.lobby || '',
    spokenLanguage: form.language || '' };
  const patch = (values: Partial<TeamsCalendarForm>) => setForm(current => ({ ...current,
    ...('attendees' in values ? { attendees: values.attendees! } : {}),
    ...('presenters' in values ? { presenters: values.presenters! } : {}),
    ...('coOrganizers' in values ? { coOrganizers: values.coOrganizers! } : {}),
    ...('recording' in values ? { recording: values.recording! } : {}),
    ...('lobbyBypass' in values ? { lobby: values.lobbyBypass === 'organization-excluding-guests' ? 'organizationExcludingGuests' : values.lobbyBypass! } : {}),
    ...('spokenLanguage' in values ? { language: values.spokenLanguage! } : {}),
  }));
  return <section aria-label="Edit original Teams meeting" className="space-y-3 rounded-xl border border-background-200 p-4">
    <h3 className="text-sm font-bold text-foreground-800">Invitations and meeting settings</h3>
    <p className="text-xs text-foreground-600">Update the verified original meeting while keeping its join link. Historical sessions, recordings and attendance are preserved.</p>
    {message && <p role="status" className="text-xs text-foreground-700">{message}</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {!uncertain && <button type="button" onClick={() => void load()} disabled={disabled || busy || Boolean(dirty) || review?.status === 'ready'}
      className="rounded-lg border border-primary-200 px-3 py-2 text-xs font-bold text-primary-700 disabled:opacity-50">
      {busy ? 'Checking original meeting…' : editable ? 'Refresh original meeting' : 'Edit existing Teams meeting'}
    </button>}
    {dirty && !uncertain && review?.status !== 'ready' && <button type="button" onClick={() => void load()} disabled={disabled || busy}
      className="text-xs font-semibold text-foreground-600 underline">Discard edits and refresh</button>}
    {data?.connectionRequired && <p className="text-xs text-amber-800">Connect the original organiser’s calendar using the calendar review below, then refresh this editor.</p>}
    {editable && <fieldset disabled={locked} className="space-y-3 disabled:opacity-70">
      <p className="break-words text-xs"><strong>Original organiser:</strong> {data.organizer}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.options && <TeamsMeetingOptionFields form={calendarForm} patch={patch} />}
        {data.rolesEditable ? <TeamsPeopleFields form={calendarForm} patch={patch} />
          : <FormField label="Attendees"><EntraPeopleInput label="Attendees" includeGuests value={calendarForm.attendees} onChange={attendees => patch({ attendees })} /></FormField>}
      </div>
      {!data.options && <p className="text-xs text-amber-800">Online meeting settings could not be verified for editing. Calendar invitees can still be updated.</p>}
      <details><summary className="cursor-pointer text-xs font-bold">Edit future session times ({data.timeZone})</summary>
        <p className="my-2 text-xs">Historical or attended sessions cannot be moved. Future moves must keep the session order and avoid selected holidays.</p>
        <div className="space-y-2">{data.sessions?.map(session => <label key={session.sessionNumber} className="flex flex-wrap items-center gap-2 text-xs">
          Session {session.sessionNumber}
          <input aria-label={`Session ${session.sessionNumber} start`} type="datetime-local" disabled={!session.editable}
            className="rounded-lg border border-background-200 p-2" value={times[session.sessionNumber] ?? localTime(session.start, data.timeZone || 'Europe/London')}
            onChange={event => setTimes(current => ({ ...current, [session.sessionNumber]: event.target.value }))} />
        </label>)}</div>
      </details>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void prepare(false)} className="rounded-lg border border-primary-300 px-3 py-2 text-xs font-bold text-primary-700">Save without notifying</button>
        <button type="button" onClick={() => void prepare(true)} className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-bold text-white">Review update and notify</button>
      </div>
    </fieldset>}
    {review?.status === 'ready' && <div className="space-y-3 rounded-lg border border-primary-200 p-3 text-xs">
      <p>{review.notificationScope}</p>
      <label className="flex gap-2"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I reviewed these edits and their notification choice.</label>
      <button type="button" onClick={() => void confirm()} disabled={!acknowledged || busy || disabled} className="rounded-lg bg-primary-600 px-3 py-2 font-bold text-white disabled:opacity-50">Confirm meeting edits</button>
      <button type="button" onClick={() => setReview(null)} disabled={busy} className="ml-3 underline">Cancel edit review</button>
    </div>}
    {uncertain && <button type="button" onClick={() => void check()} disabled={disabled || busy} className="rounded-lg border border-primary-300 px-3 py-2 text-xs font-bold">Check edit status</button>}
  </section>;
}
