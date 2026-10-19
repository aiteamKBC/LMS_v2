/**
 * The Inclusion step's button opens the live Safeguarding site — in local
 * development too, where it used to point at an unreachable 127.0.0.1:5173.
 */
import { expect, it } from 'vitest';
import { SAFEGUARDING_URL } from '../wizardInclusion';

it('opens the live Safeguarding site, even in development', () => {
  expect(import.meta.env.DEV).toBe(true);
  expect(SAFEGUARDING_URL).toBe('https://safeguarding.kentbusinesscollege.net/');
});
