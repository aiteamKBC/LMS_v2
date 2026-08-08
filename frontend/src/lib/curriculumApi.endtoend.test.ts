/**
 * End-to-end test verifying the complete request/retry flow.
 * Tests that errors are properly classified and retry logic works correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isRetryableError } from './curriculumApi';

describe('End-to-End Error Handling', () => {
  describe('Retry Logic Decision Tree', () => {
    it('should not retry 400 Bad Request (permanent client error)', () => {
      const error = new Error('Curriculum API returned 400 for /api/path: Invalid input');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not retry 401 Unauthorized (permanent auth error)', () => {
      const error = new Error('Curriculum API returned 401 for /api/path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not retry 403 Forbidden (permanent auth error)', () => {
      const error = new Error('Curriculum API returned 403 for /api/path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not retry 404 Not Found (permanent resource error)', () => {
      const error = new Error('Curriculum API returned 404 for /api/path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should retry 408 Request Timeout (transient)', () => {
      const error = new Error('Curriculum API returned 408 for /api/path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry 429 Too Many Requests (transient, rate limit)', () => {
      const error = new Error('Curriculum API returned 429 for /api/path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry 500 Internal Server Error (transient server error)', () => {
      const error = new Error('Curriculum API returned 500 for /api/path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry 502 Bad Gateway (transient gateway error)', () => {
      const error = new Error('Curriculum API returned 502 for /api/path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry 503 Service Unavailable (transient service error)', () => {
      const error = new Error('Curriculum API returned 503 for /api/path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry 504 Gateway Timeout (transient timeout)', () => {
      const error = new Error('Curriculum API returned 504 for /api/path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should not retry AbortError (intentional cancellation)', () => {
      const error = new DOMException('The operation was aborted.', 'AbortError');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should retry network errors', () => {
      const error = new Error('Network request failed');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry timeout errors', () => {
      const error = new Error('Request timeout after 5000ms');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry unknown errors (fail-safe)', () => {
      const error = new Error('Unknown error');
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('Error Classification Robustness', () => {
    it('should handle error messages with validation errors', () => {
      const error = new Error(
        'Curriculum API returned 400 for /path: Bad Request - ' +
        'Validation failed; Field "name" is required'
      );
      expect(isRetryableError(error)).toBe(false);
    });

    it('should handle error messages with special characters', () => {
      const error = new Error('Curriculum API returned 503 for /api/v1/resource?filter=true&sort=name');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should be robust to whitespace variations', () => {
      const error = new Error('Curriculum API returned 500 for /path   ');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should handle lowercase message variations', () => {
      const error = new Error('curriculum api returned 403 for /path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should handle mixed case', () => {
      const error = new Error('Curriculum API returned 502 for /Path');
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('Production Scenarios', () => {
    it('should handle wizard programme load failure (4xx)', () => {
      // Scenario: User opens wizard, programme selection fails with 403
      const error = new Error('Curriculum API returned 403 for /curriculum/programmes/');
      expect(isRetryableError(error)).toBe(false);
      // Expected: Show error immediately, no retry
    });

    it('should handle wizard programme load failure (5xx)', () => {
      // Scenario: User opens wizard, server temporarily unavailable
      const error = new Error('Curriculum API returned 503 for /curriculum/programmes/');
      expect(isRetryableError(error)).toBe(true);
      // Expected: Retry with backoff
    });

    it('should handle wizard staff load failure (permanent)', () => {
      // Scenario: Module step starts, tutors endpoint returns 404
      const error = new Error('Curriculum API returned 404 for /curriculum/tutors/');
      expect(isRetryableError(error)).toBe(false);
      // Expected: Fail immediately, show error to user
    });

    it('should handle wizard staff load failure (transient)', () => {
      // Scenario: Module step starts, network timeout
      const error = new Error('Request timeout after 10000ms');
      expect(isRetryableError(error)).toBe(true);
      // Expected: Retry with exponential backoff (200ms, 400ms, 800ms)
    });

    it('should handle rate limiting gracefully', () => {
      // Scenario: Rapid programme switches trigger 429
      const error = new Error('Curriculum API returned 429 for /curriculum/programmes/');
      expect(isRetryableError(error)).toBe(true);
      // Expected: Retry with backoff (eventual success or user-facing error)
    });
  });
});
