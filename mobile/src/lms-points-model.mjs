// Canonical LMS summary only. Local practice, timers and cached demo balances
// are deliberately not inputs to this model.
export class LmsPointsError extends Error {
  constructor(message, code = 'INVALID_POINTS_RESPONSE') { super(message); this.name = 'LmsPointsError'; this.code = code; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) || (Number.isSafeInteger(value) && value > 0);
const integer = value => typeof value === 'number' && Number.isSafeInteger(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
function invalid() { throw new LmsPointsError('Your LMS points could not be confirmed. Refresh to try again.'); }

export function normaliseLmsPoints(payload, learnerId) {
  if (!identity(learnerId)) throw new LmsPointsError('Please sign in again to load your points.', 'SESSION_REQUIRED');
  if (!object(payload) || !object(payload.points)) invalid();
  const points = payload.points;
  if (!identity(points.learnerId) || String(points.learnerId) !== String(learnerId)) {
    throw new LmsPointsError('The learner session changed. Please sign in again.', 'SESSION_CHANGED');
  }
  if (![points.earned, points.committed, points.balance].every(integer) || points.committed < 0 ||
      !Number.isSafeInteger(points.earned - points.committed) || points.balance !== points.earned - points.committed) invalid();
  if (!Array.isArray(payload.rewards) || payload.rewards.length > 100) invalid();
  const ids = new Set();
  const rewards = payload.rewards.map(reward => {
    if (!object(reward) || !text(reward.id, 180) || !reward.id.trim() || ids.has(reward.id) ||
        !text(reward.name, 255) || !reward.name.trim() || !text(reward.description, 12000) ||
        !text(reward.category, 100) || !integer(reward.points) || reward.points <= 0 ||
        !integer(reward.remaining) || reward.remaining <= 0) invalid();
    ids.add(reward.id);
    return {id:reward.id, name:reward.name, description:reward.description, category:reward.category,
      points:reward.points, remaining:reward.remaining, enoughPoints:points.balance >= reward.points};
  });
  return {source:'lms.kentbusinesscollege.org', learnerId:String(learnerId), earned:points.earned,
    committed:points.committed, balance:points.balance, rewards, policyConfirmed:false,
    leaderboardAvailable:false, redemptionAvailable:false};
}
