import { type ModuleSessionResults } from '@/api/sessionResults';
import { formatSystemTimestamp, SYSTEM_TIME_ZONE, systemDateParts } from '@/lib/format';
import { type LiveSessionAttendance, type LiveSessionArtifactOccurrence } from '@/lib/curriculumApi';


export function formatSessionDate(dateIso: string, fallback: string): string {
  const trimmed = (dateIso || '').trim();
  if (!trimmed) return fallback;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = new Date(dateOnly ? `${trimmed}T12:00:00Z` : trimmed);
  if (Number.isNaN(date.getTime())) return fallback || trimmed;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: dateOnly ? 'UTC' : SYSTEM_TIME_ZONE,
  });
}


export function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  if (!seconds) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}


export interface ReadableTranscriptCue {
  start: string;
  speaker: string;
  text: string;
}


export function formatTranscriptTimestamp(value: string): string {
  const match = /^(\d+):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const [, hours, minutes, seconds] = match;
  return hours === '00' ? `${minutes}:${seconds}` : `${hours}:${minutes}:${seconds}`;
}


/** Turn Microsoft's WEBVTT response into lines a normal user can read. */
export function parseTeamsTranscriptVtt(vtt: string): ReadableTranscriptCue[] {
  return String(vtt || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n\s*\n+/)
    .map((block): ReadableTranscriptCue | null => {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      const timeIndex = lines.findIndex(line => line.includes('-->'));
      if (timeIndex === -1) return null;
      const start = formatTranscriptTimestamp(lines[timeIndex].split('-->')[0]);
      const rawText = lines.slice(timeIndex + 1).join(' ');
      const speakerMatch = /<v\s+([^>]+)>/i.exec(rawText);
      const text = rawText
        .replace(/<\/?v[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      return text ? { start, speaker: speakerMatch?.[1]?.trim() || 'Speaker', text } : null;
    })
    .filter((cue): cue is ReadableTranscriptCue => cue !== null);
}


export function attendanceSheetRows(attendance: LiveSessionAttendance[]) {
  return attendance.map(person => {
    const intervals = Array.isArray(person.intervals) ? person.intervals : [];
    const timestampOptions: Intl.DateTimeFormatOptions = {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short',
    };
    const joins = intervals.map(item => formatSystemTimestamp(String(item.joinDateTime || ''), timestampOptions)).filter(Boolean).join('; ');
    const leaves = intervals.map(item => formatSystemTimestamp(String(item.leaveDateTime || ''), timestampOptions)).filter(Boolean).join('; ');
    const seconds = Math.max(0, Number(person.total_attendance_seconds) || 0);
    return {
      'Attendee name': person.display_name || '',
      Email: person.email || '',
      'Meeting started (UK)': person.attendance_report_start
        ? formatSystemTimestamp(person.attendance_report_start, timestampOptions)
        : '',
      Status: person.attended === false ? 'Absent' : 'Attended',
      Expected: person.expected === false ? 'No' : 'Yes',
      Role: person.role || '',
      'Join sessions': person.join_count ?? intervals.length,
      'Time in session': formatSeconds(seconds),
      'Attendance seconds': Math.round(seconds),
      'Joined at (UK)': joins,
      'Left at (UK)': leaves,
    };
  });
}


export interface AttendanceSheetGroup {
  dateKey: string;
  sheetName: string;
  attendance: LiveSessionAttendance[];
}


/** Group exported attendance by the calendar date shown to the user. Multiple
 * Teams reports from the same day share one worksheet and remain distinguishable
 * through the existing "Meeting started" column. */
export function attendanceSheetGroups(attendance: LiveSessionAttendance[]): AttendanceSheetGroup[] {
  const groups = new Map<string, AttendanceSheetGroup>();
  attendance.forEach(person => {
    const firstInterval = Array.isArray(person.intervals) ? person.intervals[0] : undefined;
    const source = String(person.attendance_report_start || firstInterval?.joinDateTime || '').trim();
    const parts = source ? systemDateParts(source) : null;
    const valid = Boolean(parts);
    const dateKey = parts
      ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
      : 'undated';
    const sheetName = valid
      ? formatSystemTimestamp(source, { day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '')
      : 'Undated attendance';
    const group = groups.get(dateKey) || { dateKey, sheetName, attendance: [] };
    group.attendance.push(person);
    groups.set(dateKey, group);
  });
  return Array.from(groups.values()).sort((left, right) => {
    if (left.dateKey === 'undated') return 1;
    if (right.dateKey === 'undated') return -1;
    return left.dateKey.localeCompare(right.dateKey);
  });
}


export function ukDateKey(value: string): string {
  const parts = systemDateParts(value);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` : '';
}


export function matchModuleSessionsByDate(data: ModuleSessionResults, date: string) {
  if (!date) return [];
  return data.series.flatMap(series => series.sessions).filter(session => ukDateKey(session.startsAt) === date);
}


/** Never replace an explicit identity with another session sharing its date. */
export function matchArtifactOccurrence(
  occurrences: LiveSessionArtifactOccurrence[],
  match: { occurrenceId?: string; sessionNumber?: number; dateIso?: string },
): LiveSessionArtifactOccurrence | null {
  if (match.occurrenceId) return occurrences.find(item => item.id === match.occurrenceId) || null;
  if (match.sessionNumber) return occurrences.find(item => item.session_number === match.sessionNumber) || null;
  const instant = Date.parse(match.dateIso || '');
  const matches = occurrences.filter(item => Number.isFinite(instant) && Date.parse(item.scheduled_start || '') === instant);
  return matches.length === 1 ? matches[0] : null;
}
