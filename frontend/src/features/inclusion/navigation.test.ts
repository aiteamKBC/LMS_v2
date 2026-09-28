import { describe, expect, it } from 'vitest';
import { inclusionLoginUrl } from './navigation';

describe('Inclusion external navigation', () => {
  it('uses the fixed production login when no deployment override is supplied', () => {
    expect(inclusionLoginUrl('https://admin.kentbusinesscollege.net'))
      .toBe('https://admin.kentbusinesscollege.net/login');
  });

  it('normalizes one trailing slash without changing the configured origin', () => {
    expect(inclusionLoginUrl('https://inclusion.example.test/'))
      .toBe('https://inclusion.example.test/login');
  });
});
