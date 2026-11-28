import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicFeedBlob, downloadAllICS, downloadICS, generateICS, generatePublicFeedICS, type ICSEvent } from './ics-generator';

const event = (changes: Partial<ICSEvent> = {}): ICSEvent => ({
  title: 'Synthetic session', description: 'Discuss learning', location: 'Online',
  date: '2 Nov', isoDate: '2026-11-02', time: '09:00–10:00', timeZone: 'Europe/London',
  ...changes,
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-20T12:34:56Z'));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('learner calendar ICS instants', () => {
  it.each(['Europe/London', 'Africa/Cairo', 'UTC', 'America/Los_Angeles'])('exports the same UK appointment on a device in %s', zone => {
    vi.stubEnv('TZ', zone);
    const ics = generateICS(event());
    expect(ics).toContain('DTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z');
    expect(ics).toContain('DTSTAMP:20261020T123456Z');
    const imported = new Date('2026-11-02T09:00:00Z');
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(imported)).toBe('11');
  });

  it('keeps the event year when exporting next January in October', () => {
    expect(generateICS(event({ isoDate: '2027-01-04', date: '4 Jan' }))).toContain('DTSTART:20270104T090000Z');
  });

  it.each([
    ['2026-10-24', 'Europe/London', '20261024T080000Z'],
    ['2026-10-28', 'Europe/London', '20261028T090000Z'],
    ['2026-10-28', 'Egypt Standard Time', '20261028T060000Z'],
    ['2026-11-02', 'Africa/Cairo', '20261102T070000Z'],
    ['2027-03-29', 'Europe/London', '20270329T080000Z'],
  ])('uses %s rules for %s', (isoDate, timeZone, expected) => {
    expect(generateICS(event({ isoDate, timeZone }))).toContain(`DTSTART:${expected}`);
  });

  it('preserves authoritative Live instants instead of reinterpreting their display time', () => {
    const ics = generateICS(event({ timeZone: 'Egypt Standard Time',
      startsAt: '2026-11-02T09:00:00+02:00', endsAt: '2026-11-02T10:30:00+02:00' }));
    expect(ics).toContain('DTSTART:20261102T070000Z\r\nDTEND:20261102T083000Z');
  });

  it('retains the elapsed duration over a repeated clock hour', () => {
    const ics = generateICS(event({ startsAt: '2026-10-25T00:30:00Z', endsAt: '2026-10-25T02:30:00Z' }));
    expect(ics).toContain('DTSTART:20261025T003000Z\r\nDTEND:20261025T023000Z');
  });

  it('uses elapsed minutes for a booked session spanning DST', () => {
    const ics = generateICS(event({ isoDate: '2026-10-25', time: '00:30–02:30', durationMinutes: 120 }));
    expect(ics).toContain('DTSTART:20261024T233000Z\r\nDTEND:20261025T013000Z');
  });

  it('keeps an overnight end in the following year', () => {
    expect(generateICS(event({ isoDate: '2026-12-31', time: '23:30–01:00' })))
      .toContain('DTSTART:20261231T233000Z\r\nDTEND:20270101T010000Z');
  });

  it.each([
    { timeZone: undefined }, { isoDate: '2026-02-30' }, { timeZone: 'Unknown/Zone' },
    { isoDate: '2026-03-29', time: '01:30–03:00' },
    { isoDate: '2026-10-25', time: '01:30–03:00' },
    { startsAt: '2026-11-02T09:00:00' },
    { startsAt: '2026-11-02T09:00:00Z', endsAt: '2026-11-02T08:00:00Z' },
    { durationMinutes: 0 },
  ])('rejects incomplete or ambiguous timing instead of inventing an instant: %j', changes => {
    expect(() => generateICS(event(changes))).toThrow();
  });

  it('uses the same corrected dates in single, all-events and feed files', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:synthetic'; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const source = [event({ isoDate: '2027-01-04' }), event({ timeZone: 'Africa/Cairo' })];
    downloadICS(source[0]);
    downloadAllICS(source);
    createPublicFeedBlob(source);
    const [single, all, feedBlob] = await Promise.all(blobs.map(readBlob));
    const feed = generatePublicFeedICS(source);
    for (const ics of [single, all, feedBlob, feed]) expect(ics).toContain('DTSTART:20270104T090000Z');
    for (const ics of [all, feedBlob, feed]) expect(ics).toContain('DTSTART:20261102T070000Z');
    expect(all.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(feed.match(/TRANSP:TRANSPARENT/g)).toHaveLength(2);
  });

  it('does not download a partially valid batch', () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL });
    expect(() => downloadAllICS([event(), event({ timeZone: undefined })])).toThrow(/time zone/);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('preserves separate legacy Clubs callers until their source supplies full dates', () => {
    const ics = generateICS(event({ isoDate: undefined, timeZone: undefined, date: '13 Jun', time: '14:00–15:00' }));
    expect(ics).toContain('DTSTART:20260613T140000\r\nDTEND:20260613T150000');
    expect(ics).toContain('DTSTAMP:20261020T123456Z');
  });
});
