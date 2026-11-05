import { useCallback, useEffect, useRef, useState } from 'react';
import {
  disconnectOrganizationCalendar,
  fetchOrganizationCalendarConnection,
  type OrganizationCalendarConnection,
} from '@/lib/curriculumApi';
import { ImportedCalendarUpdatePanel } from './ImportedCalendarUpdatePanel';

export function OrganizationCalendarConnectionPanel({ liveSessionId, disabled, onChanged }: {
  liveSessionId: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<OrganizationCalendarConnection | null>(null);
  const [failure, setFailure] = useState('');
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const attempt = ++generation.current;
    setLoading(true);
    setFailure('');
    try {
      const value = await fetchOrganizationCalendarConnection(liveSessionId);
      if (!active.current || generation.current !== attempt) return null;
      setStatus(value);
      return value;
    } catch (error) {
      if (active.current && generation.current === attempt) setFailure(error instanceof Error ? error.message : 'Organization calendar status could not be read.');
      return null;
    } finally {
      if (active.current && generation.current === attempt) setLoading(false);
    }
  }, [liveSessionId]);

  useEffect(() => {
    active.current = true;
    setStatus(null);
    void refresh();
    return () => { active.current = false; generation.current += 1; };
  }, [refresh]);

  const connected = async () => {
    const value = await refresh();
    if (active.current && value?.connected && value.organizationManaged) onChanged();
  };
  const refreshAndCheck = async () => {
    const value = await refresh();
    if (active.current && value) onChanged();
  };
  const disconnect = async () => {
    if (disabled || disconnecting || !status?.canManageOrganization || !status.revision) return;
    setDisconnecting(true);
    setFailure('');
    try {
      await disconnectOrganizationCalendar(liveSessionId, status.revision);
      if (!active.current) return;
      await refresh();
      if (active.current) onChanged();
    } catch (error) {
      if (active.current) setFailure(error instanceof Error ? error.message : 'Organization calendar access could not be disconnected.');
    } finally {
      if (active.current) setDisconnecting(false);
    }
  };

  if (status && !status.applicable) return null;
  const controls = status?.canManageOrganization && status.available && <div className="space-y-2">
    <ImportedCalendarUpdatePanel liveSessionId={liveSessionId} disabled={disabled || disconnecting}
      connectionOnly organizationManaged editorConnectionKind="group"
      onEditorConnected={() => void connected()} onUpdated={connected} />
    {status.connected && <>
      <p className="text-[11px] text-foreground-600">Disconnecting stops use of this organisation connection. Meetings and invitations stay in place.</p>
      <button type="button" onClick={() => void disconnect()} disabled={disabled || disconnecting}
        className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">
        {disconnecting ? 'Disconnecting…' : 'Disconnect organization calendar'}
      </button>
    </>}
  </div>;
  return <section aria-label="Organization calendar connection" className="space-y-2 rounded-xl border border-background-200 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-bold text-foreground-800">Organization calendar</h3>
      {status && <span className={status.connected ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
        {status.connected ? 'Connected · renews automatically' : 'Administrator action needed'}
      </span>}
    </div>
    {loading && <p role="status">Checking organization calendar access…</p>}
    {status && <p>{status.message}</p>}
    {status?.available && <p className="text-[11px] text-foreground-600">Shared across imported group calendars in the LMS.</p>}
    {failure && <p role="alert" className="text-red-700">{failure}</p>}
    {!loading && <button type="button" onClick={() => void refreshAndCheck()} disabled={disabled || disconnecting}
      className="text-xs font-bold text-primary-700 underline disabled:opacity-50">Refresh organization connection</button>}
    {status?.connected ? controls && <details className="space-y-2">
      <summary className="cursor-pointer font-semibold text-primary-700">Manage organization connection</summary>
      {controls}
    </details> : controls}
  </section>;
}
