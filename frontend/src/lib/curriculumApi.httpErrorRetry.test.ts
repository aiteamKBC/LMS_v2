/**
 * Tests for HTTP error retry classification.
 * Verifies that HTTP errors thrown from fetchJsonUncached are correctly classified
 * as retryable or non-retryable by isRetryableError.
 */

import { describe, it, expect } from 'vitest';
import { isRetryableError } from './curriculumApi';

describe('HTTP Error Retry Classification', () => {
  describe('Production error format: "Curriculum API returned NNN for /path"', () => {
    describe('4xx Client Errors - Should NOT retry', () => {
      it('should not retry 400 Bad Request', () => {
        const error = new Error('Curriculum API returned 400 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should not retry 401 Unauthorized', () => {
        const error = new Error('Curriculum API returned 401 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should not retry 403 Forbidden', () => {
        const error = new Error('Curriculum API returned 403 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should not retry 404 Not Found', () => {
        const error = new Error('Curriculum API returned 404 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should not retry 422 Unprocessable Entity', () => {
        const error = new Error('Curriculum API returned 422 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(false);
      });
    });

    describe('5xx Server Errors - Should retry', () => {
      it('should retry 500 Internal Server Error', () => {
        const error = new Error('Curriculum API returned 500 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should retry 502 Bad Gateway', () => {
        const error = new Error('Curriculum API returned 502 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should retry 503 Service Unavailable', () => {
        const error = new Error('Curriculum API returned 503 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should retry 504 Gateway Timeout', () => {
        const error = new Error('Curriculum API returned 504 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe('Special transient codes - Should retry', () => {
      it('should retry 408 Request Timeout', () => {
        const error = new Error('Curriculum API returned 408 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(true);
      });

      it('should retry 429 Too Many Requests', () => {
        const error = new Error('Curriculum API returned 429 for /curriculum/programmes/');
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe('Error message variations - Status extraction robustness', () => {
      it('should extract status with additional detail', () => {
        const error = new Error('Curriculum API returned 403 for /path: Forbidden - User lacks permission');
        expect(isRetryableError(error)).toBe(false);
      });

      it('should be case-insensitive', () => {
        const error = new Error('CURRICULUM API RETURNED 403 FOR /PATH');
        expect(isRetryableError(error)).toBe(false);
      });
    });
  });

  describe('Network errors - Should retry', () => {
    it('should retry network errors', () => {
      const error = new Error('Failed to fetch');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should retry timeout errors', () => {
      const error = new Error('Request timeout');
      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe('AbortError - Should NOT retry', () => {
    it('should not retry AbortError', () => {
      const error = new DOMException('The operation was aborted.', 'AbortError');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should return true for completely unknown errors', () => {
      const error = new Error('Something totally unexpected happened');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for null', () => {
      expect(isRetryableError(null)).toBe(true);
    });

    it('should return true for undefined', () => {
      expect(isRetryableError(undefined)).toBe(true);
    });
  });
});
