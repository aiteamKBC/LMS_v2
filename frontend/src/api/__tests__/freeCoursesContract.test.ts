import { beforeEach, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { fetchLearnerFreeCourses, type FreeCourse } from '../freeCourses';

beforeEach(() => {
  clearAllCachedResources();
  vi.restoreAllMocks();
});

it('accepts the backend week shape without displayOrder and preserves server ordering', async () => {
  const courses: FreeCourse[] = [{
    freeCourseId: 'F2', courseName: 'Synthetic course', description: '', coverImageUrl: '',
    weeks: [
      { weekId: 'W2', weekNumber: 2, weekTitle: 'Second', activities: [] },
      { weekId: 'W1', weekNumber: 1, weekTitle: 'First', activities: [] },
    ],
  }];
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ freeCourses: courses }), { status: 200 }),
  );
  const result = await fetchLearnerFreeCourses('commercial', '1', true);
  expect(result).toEqual(courses);
  expect(result[0].weeks.map(week => week.weekId)).toEqual(['W2', 'W1']);
  expect(result[0].weeks.every(week => !('displayOrder' in week))).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
