import { describe, expect, it } from 'vitest';
import { reviewHandoverMessage, type ReviewHandover } from '../reviewHandover';

const result: ReviewHandover = { transferred: ['imported-review:synthetic'], unchanged: [], historical: [], uninitialized: [], blocked: [] };
describe('reassignment outcome', () => {
  it('keeps unchanged response contracts quiet', () => {
    expect(reviewHandoverMessage()).toBeNull();
    expect(reviewHandoverMessage(result)).toBeNull();
  });
  it('reports booking and database blockers as partial assignment success', () => {
    expect(reviewHandoverMessage({ ...result, blocked: [{ code: 'booking_handover_required' }] })).toContain('links, organizers and Review ownership were retained');
    expect(reviewHandoverMessage({ ...result, blocked: [{ code: 'shared_database_verification_required' }] })).toContain('database configuration is verified');
  });
});
