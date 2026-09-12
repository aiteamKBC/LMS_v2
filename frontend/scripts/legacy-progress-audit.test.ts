/** Optional private snapshot audit; no network or database access.
 * Prepare with backend/scripts/audit_legacy_progress.py --analyse --frontend.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildUnifiedLearningSummary } from '../src/pages/learner/my-learning/SubjectWorkspace';
import type { StudentActivityResponse } from '../src/api/studentActivity';
import type { LearnerDetail } from '../src/api/learnerDetail';
import type { CoverMetadata } from '../src/pages/learner/my-learning/SubjectWorkspace';

const path = resolve(process.cwd(), '../.cache/legacy-progress-audit/frontend-cases.json.gz');
type Case = { id: number; expected: { total: number; completed: number }; data: StudentActivityResponse; real: LearnerDetail; metadata: CoverMetadata };
const cases: Case[] = existsSync(path) ? JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) : [];

describe.skipIf(!cases.length)('Every enrolled learner: Modules matches programme totals', () => {
  it.each(cases)('enrolment $id', ({ expected, data, real, metadata }) => {
    const result = buildUnifiedLearningSummary(data, real, metadata);
    expect(result.activityCount).toBe(expected.total);
    expect(result.completedActivityCount).toBe(expected.completed);
  });
});
