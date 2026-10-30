import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollaborativeField, EditScope, ModulePresence } from '../CollaborativeField';
import { CollaborationContext } from '../collaborationContext';
import { dirtyFields, fieldKey, projectAvailable } from '../collaborationProtocol';
import { getDefaultComponentSettings, recalculateModule, type ModuleCatalogueItem } from '../moduleAuthoringData';
import { useModuleCollaboration } from '../useModuleCollaboration';

const config = vi.hoisted(() => vi.fn());
vi.mock('@/lib/curriculumApi', async importOriginal => ({ ...await importOriginal<object>(), fetchCurriculumJson: (...args: unknown[]) => config(...args) }));

const baseModule = () => recalculateModule({ catalogueId: 'M1', id: 'M1', title: 'Module',
  moduleKsbMappings: [], completionCriteria: {}, advancedDetails: {}, epaRequirements: [], qualificationOutcomes: [],
  weekStructure: [{ id: 'W1', moduleId: 'M1', weekNumber: 1, title: 'Week', summary: '', learningOutcomes: [], ksbMappings: [],
    components: [{ id: 'C1', moduleId: 'M1', weekId: 'W1', type: 'reading', title: 'Original', expectedOtjh: 1,
      ksbMappings: [], settings: { ...getDefaultComponentSettings('reading'), readingSource: 'Text', readingContent: '<p>Original</p>' } },
      { id: 'C2', moduleId: 'M1', weekId: 'W1', type: 'live-session', title: 'Live', expectedOtjh: 0, ksbMappings: [],
        settings: { ...getDefaultComponentSettings('live-session'), teamsEventId: 'unchanged' } }] }],
} as unknown as ModuleCatalogueItem);
const title = fieldKey('component', 'C1', 'title');
const hours = fieldKey('component', 'C1', 'expectedOtjh');

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  static busy = new Set<string>();
  readyState = 1;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  frames: Record<string, unknown>[] = [];
  url: URL;
  constructor(url: URL) { this.url = url; Socket.instances.push(this); }
  receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  send(text: string) {
    const frame = JSON.parse(text); this.frames.push(frame);
    if (frame.type === 'claim' && Socket.busy.has(frame.key)) {
      this.receive({ type: 'error', requestId: frame.requestId, code: 'field_retry', error: 'A save is in progress; draft retained.' });
      return;
    }
    if (frame.type === 'claim') this.receive({ type: 'state', requestId: frame.requestId, ok: true, key: frame.key,
      token: 'private-token', serverTime: Date.now() / 1000, members: [], leases: [{ key: frame.key, editorId: this.url.searchParams.get('editor'), name: 'Me', expiresAt: Date.now() / 1000 + 60 }] });
    if (frame.type === 'release') this.receive({ type: 'state', requestId: frame.requestId, ok: true, leases: [] });
  }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = []; Socket.busy.clear();
  vi.stubGlobal('WebSocket', Socket);
  config.mockResolvedValue({ enabled: true, websocketPath: '/ws/curriculum/module-collaboration/M1/', heartbeatSeconds: 20 });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('field-safe save projection', () => {
  it('saves other changes while retaining the unavailable field in the draft', () => {
    const base = baseModule(), draft = structuredClone(base);
    draft.weekStructure[0].components[0].title = 'My retained draft';
    draft.weekStructure[0].components[0].expectedOtjh = 3;
    const sent = projectAvailable(base, draft, [title]);
    expect(sent.weekStructure[0].components[0].title).toBe('Original');
    expect(sent.weekStructure[0].components[0].expectedOtjh).toBe(3);
    expect(draft.weekStructure[0].components[0].title).toBe('My retained draft');
    expect(sent.weekStructure[0].components[1].settings.teamsEventId).toBe('unchanged');
    expect(dirtyFields(base, sent)).toEqual([hours]);
  });
  it('retains nested rich text and does not invent an empty field when it was absent', () => {
    const base = baseModule(), draft = structuredClone(base);
    draft.weekStructure[0].components[0].settings.readingContent = '<p>Unsaved</p>';
    draft.weekStructure[0].components[0].settings.newValue = 'New';
    const sent = projectAvailable(base, draft, [fieldKey('component', 'C1', 'settings.readingContent'), fieldKey('component', 'C1', 'settings.newValue')]);
    expect(sent.weekStructure[0].components[0].settings.readingContent).toBe('<p>Original</p>');
    expect(sent.weekStructure[0].components[0].settings).not.toHaveProperty('newValue');
  });
  it('restores a reserved deleted week and its content only in the request', () => {
    const base = baseModule(), draft = structuredClone(base); draft.weekStructure = [];
    expect(projectAvailable(base, draft, [fieldKey('week', 'W1', '$delete')]).weekStructure[0].components[0].id).toBe('C1');
    expect(draft.weekStructure).toHaveLength(0);
  });
  it('ignores derived totals, planned dates and Microsoft identity', () => {
    const base = baseModule(), draft = structuredClone(base);
    draft.declaredTotalOtjh = 100;
    draft.weekStructure[0].sessionDate = '2026-10-28';
    draft.weekStructure[0].components[0].settings.teamsEventId = 'server-owned';
    expect(dirtyFields(base, draft)).toEqual([]);
  });
});

describe('collaboration connection', () => {
  it('does one configuration read and sends no socket or heartbeat while disabled', async () => {
    config.mockResolvedValue({ enabled: false });
    renderHook(() => useModuleCollaboration('M1', vi.fn())); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(config).toHaveBeenCalledTimes(1); expect(Socket.instances).toHaveLength(0);
  });
  it('batches renewals and does not make one network request per keystroke', async () => {
    const { result } = renderHook(() => useModuleCollaboration('M1', vi.fn())); await flush();
    const socket = Socket.instances[0];
    act(() => socket.receive({ type: 'state', ok: true, members: [], leases: [] }));
    await act(async () => { for (let i = 0; i < 30; i++) await result.current.claim(title); });
    expect(socket.frames.filter(f => f.type === 'claim')).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(socket.frames.filter(f => f.type === 'heartbeat')).toHaveLength(1);
    expect(config).toHaveBeenCalledTimes(1);
  });
  it('does not renew fields in a hidden tab, and expired drafts stay pending', async () => {
    const { result } = renderHook(() => useModuleCollaboration('M1', vi.fn())); await flush();
    const socket = Socket.instances[0]; act(() => socket.receive({ type: 'state', ok: true, members: [], leases: [] }));
    await act(async () => { await result.current.claim(title); });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(socket.frames.filter(f => f.type === 'heartbeat').every(frame => (frame.renew as unknown[]).length === 0)).toBe(true);
    const base = baseModule(), draft = structuredClone(base); draft.weekStructure[0].components[0].title = 'Still mine';
    const prepared = await result.current.prepare(base, draft);
    expect(prepared.blocked).toContain(title); expect(draft.weekStructure[0].components[0].title).toBe('Still mine');
  });
  it('refuses saving on disconnect, keeps the draft and backs off reconnects', async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useModuleCollaboration('M1', onSaved)); await flush();
    act(() => Socket.instances[0].receive({ type: 'state', ok: true, members: [], leases: [] }));
    act(() => Socket.instances[0].close(1013));
    await expect(result.current.prepare(baseModule(), baseModule())).rejects.toThrow('draft is retained');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(Socket.instances).toHaveLength(2);
    act(() => Socket.instances[1].receive({ type: 'state', ok: true, members: [], leases: [] }));
    expect(onSaved).toHaveBeenCalledTimes(2);
  });
  it('keeps the page connected and saves other fields during brief grant contention', async () => {
    const { result } = renderHook(() => useModuleCollaboration('M1', vi.fn())); await flush();
    act(() => Socket.instances[0].receive({ type: 'state', ok: true, members: [], leases: [] }));
    Socket.busy.add(title);
    const base = baseModule(), draft = structuredClone(base);
    draft.weekStructure[0].components[0].title = 'Retained'; draft.weekStructure[0].components[0].expectedOtjh = 2;
    const attempt = result.current.claim(title);
    const save = result.current.prepare(base, draft);
    await expect(attempt).rejects.toThrow('save is in progress');
    const sent = await save;
    expect(sent.blocked).toContain(title);
    expect(sent.module.weekStructure[0].components[0].title).toBe('Original');
    expect(sent.module.weekStructure[0].components[0].expectedOtjh).toBe(2);
    expect(result.current.connected).toBe(true);
  });
});

describe('sidebar and field controls', () => {
  it('shows colleague names in the sidebar and keeps the reservation on its own field', () => {
    const claim = vi.fn().mockResolvedValue(true);
    const c = { enabled: true, connected: true, editorId: 'me', members: [{ editorId: 'other', name: 'Synthetic Alice' }], holder: (key: string) => key === title ? 'Synthetic Alice' : '', claim, resume: vi.fn() } as unknown as ReturnType<typeof useModuleCollaboration>;
    render(<CollaborationContext.Provider value={c}><ModulePresence collaboration={c} /><EditScope kind="component" id="C1">
      <CollaborativeField field="title"><input aria-label="Title" /></CollaborativeField>
      <CollaborativeField field="description"><input aria-label="Description" /></CollaborativeField>
    </EditScope></CollaborationContext.Provider>);
    expect(screen.getByLabelText('Title')).toBeDisabled(); expect(screen.getByLabelText('Description')).not.toBeDisabled();
    expect(screen.getByLabelText('People on this page')).toHaveTextContent('Synthetic Alice');
    expect(screen.getByLabelText('People on this page')).not.toHaveTextContent('title');
    fireEvent.focus(screen.getByLabelText('Description')); expect(claim).toHaveBeenCalledWith(fieldKey('component', 'C1', 'description'));
  });
  it('leaves shared controls outside Module Builder unchanged', () => {
    render(<CollaborativeField field="title"><input aria-label="Standalone" /></CollaborativeField>);
    expect(screen.getByLabelText('Standalone')).not.toBeDisabled();
  });
});
