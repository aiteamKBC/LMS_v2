import { useEffect, useRef, useState } from 'react';
import { fetchCurriculumJson } from '@/lib/curriculumApi';
import type { ModuleCatalogueItem } from './moduleAuthoringData';
import { dirtyFields, editValues, overlaps, projectAvailable, type Lease, type Member } from './collaborationProtocol';

type State = { enabled: boolean; connected: boolean; members: Member[]; leases: Lease[]; message: string };
type Reply = { type: string; requestId?: string; ok?: boolean; code?: string; error?: string; token?: string; key?: string; serverTime?: number; members?: Member[]; leases?: Lease[]; released?: string[] };
type Pending = { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const initial: State = { enabled: false, connected: false, members: [], leases: [], message: '' };
const retained = 'Live editing is reconnecting. Your draft is retained; saving resumes when coordination is available.';

export function useModuleCollaboration(moduleId: string, onSaved: () => void) {
  const [state, setState] = useState<State>(initial);
  const stateRef = useRef(state); stateRef.current = state;
  const callback = useRef(onSaved); callback.current = onSaved;
  const editorId = useRef(crypto.randomUUID());
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const proofs = useRef(new Map<string, { token: string; expires: number; touched: number }>());
  const claiming = useRef(new Map<string, Promise<boolean>>());
  const lost = useRef(new Set<string>());
  const offset = useRef(0);
  const now = () => Date.now() / 1000 + offset.current;
  const request = (type: string, data: Record<string, unknown> = {}): Promise<Reply> => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(retained));
    if (pending.current.size >= 128) return Promise.reject(new Error('Too many pending edits. Save or cancel before continuing.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error(retained)); }, 5000);
      pending.current.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ type, requestId, ...data }));
    });
  };
  const release = async (key: string) => {
    const proof = proofs.current.get(key);
    proofs.current.delete(key); lost.current.delete(key);
    if (proof && socket.current?.readyState === WebSocket.OPEN) await request('release', { key, token: proof.token });
  };
  const claim = (key: string): Promise<boolean> => {
    if (!stateRef.current.enabled) return Promise.resolve(true);
    const existing = proofs.current.get(key);
    if (existing && existing.expires > now()) { existing.touched = Date.now(); return Promise.resolve(true); }
    const inFlight = claiming.current.get(key);
    if (inFlight) return inFlight;
    const job = request('claim', { key }).then(reply => {
      if (reply.ok && reply.token) {
        const lease = reply.leases?.find(item => item.key === key);
        proofs.current.set(key, { token: reply.token, expires: lease?.expiresAt ?? now(), touched: Date.now() });
        lost.current.delete(key);
        return true;
      }
      return false;
    }).finally(() => { claiming.current.delete(key); });
    claiming.current.set(key, job);
    return job;
  };
  const releaseRef = useRef(release); releaseRef.current = release;

  useEffect(() => {
    setState(initial);
    proofs.current.clear(); lost.current.clear(); claiming.current.clear();
    if (!moduleId) return;
    let stopped = false, reconnect: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let reconcile: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setInterval> | undefined;
    let retries = 0;
    const queued = pending.current;
    function failPending() {
      queued.forEach(item => { clearTimeout(item.timer); item.reject(new Error(retained)); }); queued.clear();
    }
    function connect(path: string, heartbeatSeconds: number) {
      if (stopped) return;
      const url = new URL(path, window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('editor', editorId.current);
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onmessage = event => {
        if (stopped || socket.current !== ws) return;
        let reply: Reply;
        try { reply = JSON.parse(String(event.data)) as Reply; } catch { ws.close(); return; }
        if (reply.serverTime) offset.current = reply.serverTime - Date.now() / 1000;
        if (reply.type === 'saved') { callback.current(); return; }
        if (reply.type === 'state' && reply.ok === false && reply.code === 'connection_expired') { ws.close(); return; }
        if (reply.type === 'state' && reply.ok && !reply.requestId) {
          retries = 0;
          setState({ enabled: true, connected: true, members: reply.members || [], leases: reply.leases || [], message: '' });
          callback.current(); // reconnect always checks authoritative saved revisions
          if (heartbeat) clearInterval(heartbeat);
          if (reconcile) clearInterval(reconcile);
          if (expiry) clearInterval(expiry);
          expiry = setInterval(expireReservations, 1000);
          // External calendar/import writers also move the saved version. A
          // slow reconciliation catches them and a dropped socket notification.
          reconcile = setInterval(() => { if (document.visibilityState === 'visible') callback.current(); }, 60_000);
          heartbeat = setInterval(() => {
            const renew: { key: string; token: string }[] = [];
            proofs.current.forEach((proof, key) => {
              if (document.visibilityState === 'visible' && Date.now() - proof.touched < 40_000
                && renew.length < 64 && JSON.stringify(renew).length + key.length < 12_000) renew.push({ key, token: proof.token });
            });
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat', renew }));
          }, heartbeatSeconds * 1000);
        }
        if (reply.members || reply.leases || reply.released) setState(current => {
          const leases = reply.type === 'state' ? reply.leases || current.leases : [
            ...current.leases.filter(lease => !reply.released?.includes(lease.key) && !reply.leases?.some(item => item.key === lease.key)),
            ...reply.leases || [],
          ];
          return { ...current, members: reply.members || current.members, leases };
        });
        if (reply.type === 'state' && reply.leases) proofs.current.forEach((proof, key) => {
          const own = reply.leases?.find(lease => lease.key === key && lease.editorId === editorId.current);
          if (own) proof.expires = own.expiresAt;
          else { proofs.current.delete(key); lost.current.add(key); }
        });
        const item = reply.requestId ? queued.get(reply.requestId) : undefined;
        if (item) {
          clearTimeout(item.timer); queued.delete(reply.requestId!);
          if (reply.type === 'error') item.reject(new Error(reply.error || retained)); else item.resolve(reply);
        }
      };
      ws.onclose = event => {
        if (stopped || socket.current !== ws) return;
        if (heartbeat) clearInterval(heartbeat);
        if (reconcile) clearInterval(reconcile);
        if (expiry) clearInterval(expiry);
        proofs.current.forEach((_, key) => lost.current.add(key)); proofs.current.clear(); failPending();
        setState(current => ({ ...current, connected: false, members: [], leases: [], message: retained }));
        if (![4400, 4403, 4404].includes(event.code)) reconnect = setTimeout(() => connect(path, heartbeatSeconds), Math.min(30_000, 1000 * 2 ** retries++));
      };
    }
    void fetchCurriculumJson<{ enabled: boolean; websocketPath?: string; heartbeatSeconds?: number }>(`/curriculum/modules/${encodeURIComponent(moduleId)}/collaboration/`, { skipCache: true }).then(config => {
      if (stopped || !config.enabled || !config.websocketPath) return;
      setState({ ...initial, enabled: true, message: retained });
      connect(config.websocketPath, Math.max(10, config.heartbeatSeconds || 20));
    }).catch(() => {
      // Optional presence discovery must not disable existing authoring when
      // unavailable. The HTTP revision + server lease guard still protects saves.
      if (!stopped) setState({ ...initial, message: 'Live presence is unavailable. Versioned saving remains protected.' });
    });
    function expireReservations() {
      let expired = false;
      proofs.current.forEach((proof, key) => { if (proof.expires <= now()) { proofs.current.delete(key); lost.current.add(key); expired = true; } });
      setState(current => expired || current.leases.some(lease => lease.expiresAt <= now())
        ? { ...current, leases: current.leases.filter(lease => lease.expiresAt > now()),
          message: expired ? 'An idle field reservation expired. Your draft is retained. Recheck available fields before saving it.' : current.message } : current);
    }
    const onVisible = () => { if (stateRef.current.enabled && document.visibilityState === 'visible') callback.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true; clearTimeout(reconnect); clearInterval(heartbeat); clearInterval(reconcile); clearInterval(expiry);
      document.removeEventListener('visibilitychange', onVisible);
      socket.current?.close(); socket.current = null; failPending();
    };
  }, [moduleId]);

  const prepare = async (base: ModuleCatalogueItem, draft: ModuleCatalogueItem) => {
    if (!stateRef.current.enabled) return { module: draft, blocked: [] as string[], collaboration: undefined };
    if (!stateRef.current.connected) throw new Error(retained);
    const keys = dirtyFields(base, draft), blocked: string[] = [];
    // Wait for a focus claim already in flight. Imports and other bulk actions
    // need no round trip per field: the HTTP save checks them atomically under
    // the module-row lock, using its existing revision/three-way merge.
    for (const key of keys) {
      if (claiming.current.has(key)) {
        try { await claiming.current.get(key); }
        catch { blocked.push(key); continue; }
      }
      const proof = proofs.current.get(key);
      if (proof && proof.expires <= now()) { proofs.current.delete(key); lost.current.add(key); }
      const [kind, id, field] = JSON.parse(key) as string[];
      const childBusy = kind === 'week' && field === '$delete' && stateRef.current.leases.some(lease => {
        const [lk, lid] = JSON.parse(lease.key) as string[];
        return lease.editorId !== editorId.current && lk === 'component' && base.weekStructure.find(w => w.id === id)?.components.some(c => c.id === lid);
      });
      if (childBusy || lost.current.has(key) || stateRef.current.leases.some(lease =>
        lease.editorId !== editorId.current && lease.expiresAt > now() && overlaps(key, lease.key))) blocked.push(key);
    }
    const ownership = Object.fromEntries([...proofs.current].map(([key, value]) => [key, value.token]));
    return { module: projectAvailable(base, draft, blocked), blocked, collaboration: { editorId: editorId.current, proofs: ownership } };
  };
  const saved = async (sent: ModuleCatalogueItem, latest: ModuleCatalogueItem) => {
    const a = editValues(sent), b = editValues(latest);
    await Promise.all([...proofs.current.keys()].filter(key => JSON.stringify(a.get(key)) === JSON.stringify(b.get(key)))
      .map(key => releaseRef.current(key).catch(() => {
        setState(current => ({ ...current, message: 'Content saved. The field reservation will release automatically when the connection recovers or its short expiry ends.' }));
      })));
  };
  const cancel = () => { void Promise.all([...proofs.current.keys()].map(key => releaseRef.current(key))).catch(() => setState(current => ({ ...current, message: retained }))); };
  const resume = () => { callback.current(); lost.current.clear(); setState(current => ({ ...current, message: '' })); };
  const rejectFields = (keys: string[]) => { keys.forEach(key => lost.current.add(key)); };
  const holder = (key: string) => state.leases.find(lease => lease.editorId !== editorId.current && lease.expiresAt > now() && overlaps(key, lease.key))?.name || '';
  return { ...state, editorId: editorId.current, claim, prepare, saved, cancel, resume, rejectFields, holder };
}
export type ModuleCollaboration = ReturnType<typeof useModuleCollaboration>;
