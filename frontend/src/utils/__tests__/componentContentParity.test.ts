import { describe, expect, it } from 'vitest';
import { hasComponentContent, type JourneyComponent } from '../learnerJourney';
import cases from './componentContentCases.json';

/** learner_api/weekly_learning.component_content_available runs the same cases. */
describe('component content availability', () => {
  it.each(cases)('$name', ({ component, expected }) => {
    expect(hasComponentContent({ title: 'Activity', expectedOtjh: null, ...component } as JourneyComponent)).toBe(expected);
  });

  it('uses a compact row\'s server verdict instead of the fields it replaces', () => {
    expect(hasComponentContent({ title: 'Reading', expectedOtjh: null, type: 'reading', contentAvailable: true })).toBe(true);
    expect(hasComponentContent({ title: 'Reading', expectedOtjh: null, type: 'reading', hasReadingContent: true, contentAvailable: false })).toBe(false);
  });
});
