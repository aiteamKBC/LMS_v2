/** Business clocks use the zone's rules on the event date, never the PC's offset. */
export const BUSINESS_TIME_ZONE = 'Europe/London';

const aliases: Record<string, string> = {
  'GMT Standard Time': 'Europe/London',
  'Egypt Standard Time': 'Africa/Cairo',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Arabian Standard Time': 'Asia/Dubai',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles',
};
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string) {
  const name = aliases[zone] || zone;
  let value = formatters.get(name);
  if (!value) {
    value = new Intl.DateTimeFormat('en-GB', {
      timeZone: name, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
    formatters.set(name, value);
  }
  return value;
}

function civilMillis(parts: number[]) {
  const [year, month, day, hour, minute, second, millisecond] = parts;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

function localParts(instant: number, zone: string) {
  const parts = formatter(zone).formatToParts(new Date(instant));
  return ['year', 'month', 'day', 'hour', 'minute', 'second']
    .map(type => Number(parts.find(part => part.type === type)!.value));
}

/** The zone's actual UTC offset at this instant, including seconds/milliseconds. */
export function zoneOffsetMs(instant: Date, zone: string): number {
  return civilMillis([...localParts(instant.getTime(), zone), instant.getUTCMilliseconds()]) - instant.getTime();
}

/** Convert a strict civil ISO value; an explicit offset preserves its instant. */
export function localClockToUtcIso(value: string, zone: string): string {
  formatter(zone); // Validate even when the value carries an explicit offset.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new RangeError('Choose a valid date and time.');
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]),
    Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0), Number((match[7] || '').padEnd(3, '0'))];
  const wall = civilMillis(parts);
  const check = new Date(wall);
  if ([check.getUTCFullYear(), check.getUTCMonth() + 1, check.getUTCDate(), check.getUTCHours(), check.getUTCMinutes(), check.getUTCSeconds(), check.getUTCMilliseconds()]
    .some((part, index) => part !== parts[index])) throw new RangeError('Choose a valid date and time.');
  if (match[8]) {
    const instant = Date.parse(`${value.replace(' ', 'T')}`);
    if (!Number.isFinite(instant)) throw new RangeError('Choose a valid date and time.');
    return new Date(instant).toISOString();
  }
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const probe = wall + hours * 3_600_000;
    offsets.add(civilMillis([...localParts(probe, zone), parts[6]]) - probe);
  }
  const candidates = [...offsets].map(offset => wall - offset)
    .filter(instant => localParts(instant, zone).every((part, index) => part === parts[index]));
  if (!candidates.length) throw new RangeError('This local time does not exist because the clocks move forward. Choose another time.');
  if (candidates.length > 1) throw new RangeError('This local time occurs twice because the clocks move back. Choose another time or supply an explicit offset.');
  return new Date(candidates[0]).toISOString();
}

/** Legacy JS sign: UTC minus UK clock, for daytime coach booking API payloads. */
export function ukOffsetForDate(day: string): number {
  const noon = localClockToUtcIso(`${day}T12:00:00`, BUSINESS_TIME_ZONE);
  return (Date.parse(noon) - Date.parse(`${day}T12:00:00Z`)) / 60_000;
}
