import type { AIReportEvidence } from './types';

interface TranscriptCue {
  speaker: string;
  text: string;
  start: string;
  end: string;
  startMs: number;
  endMs: number;
}

const TIMESTAMP_PATTERN = String.raw`(?:\d{1,2}:)?\d{2}:\d{2}(?:\.\d{1,3})?`;
const TIMESTAMP_RE = new RegExp(TIMESTAMP_PATTERN, 'g');

function cleanText(text: string) {
  return text
    .replace(/<\/?v[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value: string | null | undefined) {
  return cleanText(String(value ?? ''))
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function timestampToMs(value: string) {
  const [whole, fraction = ''] = value.trim().split('.');
  const parts = whole.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else {
    [seconds] = parts;
  }

  const millis = Number((fraction + '000').slice(0, 3));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + (Number.isFinite(millis) ? millis : 0);
}

function parseTranscriptCues(raw: string | null | undefined): TranscriptCue[] {
  if (!raw) return [];

  const compact = raw
    .replace(/\r/g, '')
    .replace(/^WEBVTT.*$/gim, ' ')
    .replace(/^\s*\d+\s*$/gm, ' ')
    .replace(/\n+/g, ' ');

  const cuePattern = new RegExp(
    `(${TIMESTAMP_PATTERN})\\s*-->\\s*(${TIMESTAMP_PATTERN})[^<]*(?:<v\\s+([^>]+)>)?([\\s\\S]*?)(?=\\s*${TIMESTAMP_PATTERN}\\s*-->|$)`,
    'g',
  );
  const cues: TranscriptCue[] = [];
  let match: RegExpExecArray | null;

  while ((match = cuePattern.exec(compact)) !== null) {
    const [, start, end, speaker = 'Speaker', content] = match;
    const startMs = timestampToMs(start);
    const endMs = timestampToMs(end);
    const text = cleanText(content);

    if (!text || startMs === null || endMs === null) continue;
    cues.push({ speaker: cleanText(speaker) || 'Speaker', text, start, end, startMs, endMs });
  }

  return cues;
}

function quoteNeedles(quote: string | null | undefined) {
  const normalized = normalizeForMatch(quote);
  if (!normalized) return [];

  const words = normalized.split(' ').filter(Boolean);
  const firstWords = words.slice(0, 12).join(' ');
  const firstChars = normalized.slice(0, 90).replace(/\s+\S*$/, '').trim();

  return Array.from(new Set([normalized, firstChars, firstWords]))
    .filter((needle) => needle.length >= 18);
}

function speakerMatches(evidenceSpeaker: string | null | undefined, cueSpeaker: string) {
  const evidence = normalizeForMatch(evidenceSpeaker);
  if (!evidence) return true;

  const cue = normalizeForMatch(cueSpeaker);
  return cue === evidence || cue.includes(evidence) || evidence.includes(cue);
}

function quoteMatchesCue(evidence: AIReportEvidence, cue: TranscriptCue) {
  const cueText = normalizeForMatch(cue.text);
  return quoteNeedles(evidence.quote).some((needle) => cueText.includes(needle) || needle.includes(cueText));
}

function inferEndFromTranscript(evidence: AIReportEvidence, transcript: string | null | undefined, start: string) {
  const cues = parseTranscriptCues(transcript);
  if (cues.length === 0) return null;

  const startMs = timestampToMs(start);
  if (startMs !== null) {
    const byTime = cues.find((cue) => (
      (Math.abs(cue.startMs - startMs) <= 1200 || (startMs >= cue.startMs - 500 && startMs <= cue.endMs + 500)) &&
      speakerMatches(evidence.speaker, cue.speaker)
    )) ?? cues.find((cue) => Math.abs(cue.startMs - startMs) <= 1200 || (startMs >= cue.startMs - 500 && startMs <= cue.endMs + 500));

    if (byTime) return byTime.end;
  }

  const byQuote = cues.find((cue) => speakerMatches(evidence.speaker, cue.speaker) && quoteMatchesCue(evidence, cue))
    ?? cues.find((cue) => quoteMatchesCue(evidence, cue));

  return byQuote?.end ?? null;
}

export function formatEvidenceTimeRange(
  evidence: AIReportEvidence | null | undefined,
  transcript?: string | null,
) {
  const matches = evidence?.timecode?.match(TIMESTAMP_RE) ?? [];
  if (matches.length === 0 || !evidence) return null;

  const start = matches[0];
  const end = matches[1] ?? inferEndFromTranscript(evidence, transcript, start) ?? start;
  return `From ${start} to ${end}`;
}
