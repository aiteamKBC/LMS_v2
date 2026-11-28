import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/pages/learner/attendance/lectureCounts.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { lectureCounts, isAttendedLecture, isAbsentLecture } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);
const row = (liveAttendanceStatus, counted = true, extra = {}) => ({
  status: liveAttendanceStatus === 'present' ? 'completed' : liveAttendanceStatus,
  liveAttendanceStatus, counted, catchupStatus: null, ...extra,
});

test('20/24 stays fixed during Recorded and becomes 21/25 after a live visit', () => {
  const before = Array.from({ length: 24 }, (_, i) => row(i < 20 ? 'present' : 'absent'));
  const recordings = [row('unmarked', false, { status: 'completed', attendanceBasis: 'recorded', effectiveAttendance: 1 })];
  const frozen = lectureCounts([...before, ...recordings]);
  assert.equal(frozen.attended, 20);
  assert.equal(frozen.absent, 4);
  assert.equal(frozen.rate, 83);
  const visited = lectureCounts([...before, ...recordings, row('present')]);
  assert.equal(visited.attended, 21);
  assert.equal(visited.absent, 4);
  assert.equal(visited.rate, 84);
});

test('recording completion does not erase an earlier live absence', () => {
  const watched = row('absent', true, { status: 'completed', attendanceBasis: 'recorded', effectiveAttendance: 1 });
  assert.equal(isAttendedLecture(watched), false);
  assert.equal(isAbsentLecture(watched), true);
  assert.equal(lectureCounts([watched]).rate, 0);
});

test('Recorded from the start has no attendance percentage until a live visit', () => {
  const noShow = row('unmarked', false, { status: 'awaiting_recording' });
  assert.equal(lectureCounts([noShow]).rate, null);
  assert.equal(lectureCounts([noShow, row('present')]).rate, 100);
});

test('verified live catch-up still counts and is separate from recording completion', () => {
  const catchup = row('present', true, { status: 'absent', effectiveAttendance: 1, catchupStatus: 'completed' });
  assert.equal(isAttendedLecture(catchup), true);
  assert.equal(isAbsentLecture(catchup), false);
  assert.equal(lectureCounts([catchup]).covered, 1);
});

test('unmarked, upcoming and in-progress sessions add no attendance target', () => {
  const counts = lectureCounts(['unmarked', 'upcoming', 'in_progress'].map(status => row(status, false)));
  assert.equal(counts.attended, 0);
  assert.equal(counts.absent, 0);
  assert.equal(counts.upcoming, 1);
  assert.equal(counts.rate, null);
});

test('cached payloads without the new field retain ordinary live attendance', () => {
  assert.equal(lectureCounts([{ status: 'late' }, { status: 'absent' }]).rate, 50);
  assert.equal(isAttendedLecture({ status: 'completed', attendanceBasis: 'recorded' }), false);
});
