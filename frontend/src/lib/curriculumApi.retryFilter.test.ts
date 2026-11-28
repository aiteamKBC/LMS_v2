/**
 * Tests for isRetryableError function.
 * Verifies that transient errors are retried and permanent errors are not.
 */

import { describe, it, expect } from 'vitest';
import { isRetryableError } from './curriculumApi';

describe('isRetryableError', () => {
  describe('Transient errors (should retry)', () => {
    it('should return true for 408 Request Timeout', () => {
      const response = new Response(null, { status: 408 });
      expect(isRetryableError(response)).toBe(true);
    });

    it('should return true for 429 Too Many Requests', () => {
      const response = new Response(null, { status: 429 });
      expect(isRetryableError(response)).toBe(true);
    });

    it('should return true for 500 Internal Server Error', () => {
      const response = new Response(null, { status: 500 });
      expect(isRetryableError(response)).toBe(true);
    });

    it('should return true for 502 Bad Gateway', () => {
      const response = new Response(null, { status: 502 });
      expect(isRetryableError(response)).toBe(true);
    });

    it('should return true for 503 Service Unavailable', () => {
      const response = new Response(null, { status: 503 });
      expect(isRetryableError(response)).toBe(true);
    });

    it('should return true for 504 Gateway Timeout', () => {
      const response = new Response(null, { status: 504 });
      expect(isRetryableError(response)).toBe(true);
    });
  });

  describe('Permanent errors (should not retry)', () => {
    it('should return false for 400 Bad Request', () => {
      const response = new Response(null, { status: 400 });
      expect(isRetryableError(response)).toBe(false);
    });

    it('should return false for 401 Unauthorized', () => {
      const response = new Response(null, { status: 401 });
      expect(isRetryableError(response)).toBe(false);
    });

    it('should return false for 403 Forbidden', () => {
      const response = new Response(null, { status: 403 });
      expect(isRetryableError(response)).toBe(false);
    });

    it('should return false for 404 Not Found', () => {
      const response = new Response(null, { status: 404 });
      expect(isRetryableError(response)).toBe(false);
    });

    it('should return false for 422 Unprocessable Entity', () => {
      const response = new Response(null, { status: 422 });
      expect(isRetryableError(response)).toBe(false);
    });
  });

  describe('Abort signals', () => {
    it('should return false for AbortError', () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      expect(isRetryableError(abortError)).toBe(false);
    });
  });

  describe('HTTP Errors Embedded in Error Messages', () => {
    it('should return false for 400 in Error message', () => {
      const error = new Error('Curriculum API returned 400 for /path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for 401 in Error message', () => {
      const error = new Error('Curriculum API returned 401 for /path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for 403 in Error message', () => {
      const error = new Error('Curriculum API returned 403 for /path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for 404 in Error message', () => {
      const error = new Error('Curriculum API returned 404 for /path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return true for 408 in Error message', () => {
      const error = new Error('Curriculum API returned 408 for /path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 429 in Error message', () => {
      const error = new Error('Curriculum API returned 429 for /path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 500 in Error message', () => {
      const error = new Error('Curriculum API returned 500 for /path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 502 in Error message', () => {
      const error = new Error('Curriculum API returned 502 for /path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 503 in Error message', () => {
      const error = new Error('Curriculum API returned 503 for /path');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 504 in Error message', () => {
      const error = new Error('Curriculum API returned 504 for /path');
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('Network Errors', () => {
    it('should return true for network error', () => {
      const error = new Error('Network request failed');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for timeout error', () => {
      const error = new Error('Request timeout');
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('Unknown errors', () => {
    it('should return true for generic Error', () => {
      const error = new Error('Something went wrong');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for null', () => {
      expect(isRetryableError(null)).toBe(true);
    });
  });
});
