import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import {
  checkImportedCalendarUpdate,
  connectImportedCalendar,
  confirmImportedCalendarUpdate,
  fetchImportedCalendarConnection,
  previewImportedCalendarUpdate,
  type ImportedCalendarPreview,
  type ImportedCalendarUpdateResult,
} from '@/lib/curriculumApi';

function sessionTime(value: string, timeZone?: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: timeZone || 'UTC',
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

export function ImportedCalendarUpdatePanel({ liveSessionId, disabled, onUpdated, editorConnectionKind, onEditorConnected }: {
  liveSessionId: string;
  disabled: boolean;
  onUpdated: () => Promise<void>;
  editorConnectionKind?: 'user' | 'group' | null;
  onEditorConnected?: () => void;
}) {
  const [preview, setPreview] = useState<ImportedCalendarPreview | null>(null);
  const [result, setResult] = useState<ImportedCalendarUpdateResult | null>(null);
  const [busy, setBusy] = useState<'review' | 'send' | 'status' | 'connect' | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [failure, setFailure] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const recoveryOperationId = useRef<string | undefined>(undefined);
  const disconnectPopup = useRef<(() => void) | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; disconnectPopup.current?.(); };
  }, []);

  const applyResult = async (value: ImportedCalendarUpdateResult) => {
    if (!active.current) return;
    if (value.operationId) recoveryOperationId.current = value.operationId;
    setResult(value);
    setPreview(null);
    setUncertain(value.status === 'verification_pending' || (uncertain && Boolean(value.connectionRequired)));
    if (value.status === 'confirmed') {
      try { await onUpdated(); }
      catch {
        if (active.current) setFailure('The calendar update is confirmed. Reopen this module to refresh the displayed dates.');
      }
    }
  };

  const review = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    recoveryOperationId.current = undefined;
    setBusy('review'); setFailure(''); setPreview(null); setResult(null); setAcknowledged(false);
    try {
      const value = await previewImportedCalendarUpdate(liveSessionId);
      if (!active.current) return;
      if (value.operationId) recoveryOperationId.current = value.operationId;
      setPreview(value);
      setUncertain(value.status === 'verification_pending');
      if (value.status === 'up_to_date') await onUpdated();
    } catch (error) {
      if (active.current) setFailure(error instanceof Error ? error.message : 'The original calendar could not be checked. Retry the review.');
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(null);
    }
  };

  const confirm = async () => {
    if (inFlight.current || disabled || preview?.status !== 'ready' || !preview.previewToken
      || (preview.calendarChangeRequired !== false && !acknowledged)) return;
    inFlight.current = true;
    setBusy('send'); setFailure('');
    try {
      await applyResult(await confirmImportedCalendarUpdate(liveSessionId, preview.previewToken, acknowledged));
    } catch {
      // A timeout may occur after Microsoft accepted the PATCH. Check its
      // outcome before offering another confirmation or generating a new review.
      if (active.current) {
        setUncertain(true);
        setFailure('The result could not be confirmed. Check update status before attempting another calendar update.');
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(null);
    }
  };

  const check = async () => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy('status'); setFailure('');
    try { await applyResult(await checkImportedCalendarUpdate(liveSessionId, result?.operationId || preview?.operationId || recoveryOperationId.current)); }
    catch {
      if (active.current) setFailure('The result is still unavailable. Check again; this check does not resend the update.');
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(null);
    }
  };

  const connect = async () => {
    if (inFlight.current || disabled) return;
    const popup = window.open('', 'lms-teams-calendar-connect', 'popup,width=620,height=740');
    if (!popup) { setFailure('Allow the Microsoft sign-in popup, then try connecting again.'); return; }
    inFlight.current = true;
    setBusy('connect'); setFailure('');
    let timer: ReturnType<typeof setInterval> | undefined;
    let complete = false;
    const cleanup = () => {
      if (timer) clearInterval(timer);
      window.removeEventListener('message', receive);
      disconnectPopup.current = null;
    };
    let callbackOrigin = '';
    const finish = async (message?: string) => {
      if (complete) return;
      complete = true;
      cleanup();
      try {
        const connection = await fetchImportedCalendarConnection(liveSessionId);
        if (!active.current) return;
        if (!connection.connected) {
          setFailure(message || connection.message || 'Microsoft calendar access was not connected. Sign in with an account authorised to edit this original calendar.');
          return;
        }
        if (editorConnectionKind && !uncertain) {
          onEditorConnected?.();
          return;
        }
        inFlight.current = false;
        if (uncertain) await check();
        else await review();
      } catch {
        if (active.current) setFailure('The calendar connection could not be verified. Retry connecting before updating the series.');
      } finally {
        inFlight.current = false;
        if (active.current) setBusy(null);
      }
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== popup || event.origin !== callbackOrigin || !event.data
        || event.data.type !== 'lms:teams-calendar-connected' || event.data.liveSessionId !== liveSessionId) return;
      void finish(event.data.ok ? undefined : typeof event.data.error === 'string' ? event.data.error : 'Microsoft calendar connection was not completed.');
    };
    disconnectPopup.current = cleanup;
    try {
      const connection = await connectImportedCalendar(liveSessionId, editorConnectionKind || result?.connectionKind || preview?.connectionKind || 'user');
      if (!active.current) { popup.close(); return; }
      const authorization = new URL(connection.authorizationUrl);
      if (authorization.protocol !== 'https:' || authorization.hostname !== 'login.microsoftonline.com') throw new Error('Unsupported Microsoft sign-in address.');
      callbackOrigin = new URL(connection.callbackOrigin).origin;
      window.addEventListener('message', receive);
      popup.location.href = authorization.href;
      const expires = Date.now() + 10 * 60 * 1000;
      timer = setInterval(() => {
        if (popup.closed) void finish();
        else if (Date.now() >= expires) void finish('The Microsoft sign-in window expired. Start the connection again.');
      }, 1000);
    } catch (error) {
      cleanup(); popup.close(); inFlight.current = false;
      if (active.current) {
        setBusy(null);
        setFailure(error instanceof Error ? error.message : 'Microsoft calendar sign-in could not start.');
      }
    }
  };

  const ready = preview?.status === 'ready' && Boolean(preview.previewToken) && !uncertain;
  const importingOnly = preview?.calendarChangeRequired === false;
  return (
    <section aria-label="Update the original Teams calendar" className="space-y-3 rounded-xl border border-primary-200 bg-primary-50/30 p-4">
      <h3 className="text-sm font-bold text-foreground-800">Update the original Teams calendar</h3>
      <p className="text-[12px] leading-5 text-foreground-600">
        Add planned sessions at the end of this existing series. Review the dates first, then confirm to
        update Microsoft and notify the existing invitees. The meeting keeps its join link.
      </p>
      {failure && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">{failure}</p>}
      {(preview || result) && <p role="status" className="text-[12px] leading-5 text-foreground-700">{result?.message || preview?.message}</p>}
      {(editorConnectionKind || result?.connectionRequired || preview?.connectionRequired) && <div className="space-y-2 text-[12px]">
        <p>Connect a Microsoft account authorised to edit the original calendar. Microsoft may require your administrator's consent. Connecting does not send invitations.</p>
        <button type="button" onClick={() => void connect()} disabled={disabled || Boolean(busy)}
          className="rounded-lg border border-primary-200 px-3 py-2 font-bold text-primary-700 disabled:opacity-50">
          {busy === 'connect' ? 'Complete Microsoft sign-in…' : 'Connect Microsoft calendar'}
        </button>
      </div>}
      {ready && preview && <div className="space-y-3 rounded-lg border border-primary-200 bg-white p-3 text-[12px]">
        {preview.organizer && <p><strong>Calendar organiser:</strong> {[preview.organizer.name, preview.organizer.email].filter(Boolean).join(' · ')}</p>}
        {preview.currentEndDate && preview.proposedEndDate && <p><strong>Series end:</strong> {preview.currentEndDate} → {preview.proposedEndDate}</p>}
        <p><strong>Times:</strong> {preview.timeZone || 'UTC'}</p>
        <ul className="space-y-2">
          {preview.addedSessions.map(session => <li key={session.start}>
            {sessionTime(session.start, preview.timeZone)} – {sessionTime(session.end, preview.timeZone)}
          </li>)}
        </ul>
        {typeof preview.existingInviteeCount === 'number' && <p><strong>Existing invitees:</strong> {preview.existingInviteeCount}</p>}
        {preview.joinUrl && <p className="break-all"><strong>Existing join link:</strong> {preview.joinUrl}</p>}
        {importingOnly ? <p>The dates already exist in Microsoft. Confirming imports them into the LMS and sends no calendar update.</p>
          : <>
            <p>{preview.notificationScope || 'Microsoft will send a calendar update to the existing invitees. Separately edited occurrences may produce additional update messages.'}</p>
            <label className="flex items-start gap-2 font-semibold">
              <input type="checkbox" checked={acknowledged} disabled={Boolean(busy)} onChange={event => setAcknowledged(event.target.checked)} className="mt-0.5" />
              I checked the dates and want to update this series and notify its existing invitees.
            </label>
          </>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void confirm()} disabled={disabled || Boolean(busy) || (!importingOnly && !acknowledged)}
            className="rounded-lg bg-primary-600 px-3 py-2 font-bold text-white disabled:opacity-50">
            {busy === 'send' ? 'Applying and verifying…' : importingOnly ? 'Import confirmed Teams dates' : 'Update series and send'}
          </button>
          <button type="button" onClick={() => setPreview(null)} disabled={Boolean(busy)} className="rounded-lg border border-background-200 px-3 py-2 font-semibold">Cancel</button>
        </div>
      </div>}
      {uncertain ? <button type="button" onClick={() => void check()} disabled={disabled || Boolean(busy)}
        className="rounded-lg border border-primary-200 px-3 py-2 text-[12px] font-bold text-primary-700 disabled:opacity-50">
        {busy === 'status' ? 'Checking Microsoft…' : 'Check update status'}
      </button> : !ready && <button type="button" onClick={() => void review()} disabled={disabled || Boolean(busy)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
        <AppIcon className={busy === 'review' ? 'ri-loader-4-line animate-spin' : 'ri-calendar-check-line'} />
        {busy === 'review' ? 'Reading the original calendar…' : 'Review Teams calendar update'}
      </button>}
    </section>
  );
}
