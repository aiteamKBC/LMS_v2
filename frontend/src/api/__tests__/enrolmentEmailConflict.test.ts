import { afterEach, expect, it, vi } from 'vitest';
import { createEnrolmentUser, EnrolmentUserApiError, updateEnrolmentUser } from '../enrolmentUsers';

afterEach(() => vi.unstubAllGlobals());

it.each(['create', 'edit'] as const)('preserves the existing learner link from a %s conflict response', async action => {
  const existingUser = { id: '42', name: 'Existing Learner', programme: '', learnerType: 'commercial', archived: true };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Email already exists.', existingUser }), {
    status: action === 'create' ? 400 : 409, headers: { 'Content-Type': 'application/json' },
  })));
  const promise = action === 'create'
    ? createEnrolmentUser({ username: 'New Learner', email: 'existing@example.test' })
    : updateEnrolmentUser('7', { email: 'existing@example.test' });
  await expect(promise).rejects.toMatchObject({ name: 'EnrolmentUserApiError', message: 'Email already exists.', existingUser });
});

it('keeps older error responses readable when no existing learner is supplied', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Validation failed.' }), { status: 400 })));
  await expect(updateEnrolmentUser('7', { email: 'bad' })).rejects.toBeInstanceOf(EnrolmentUserApiError);
});
