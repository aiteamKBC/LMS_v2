import { describe, expect, it } from 'vitest';
import { evidenceScanDisplayState } from './evidence';

describe('Evidence scanner lifecycle presentation', () => {
  it('keeps active and promotion-pending files visibly processing', () => {
    for (const state of ['pending_upload', 'quarantined', 'scan_pending', 'scanning', 'clean_verified'] as const) {
      expect(evidenceScanDisplayState(state)).toBe('processing');
    }
  });

  it('distinguishes a scheduled retry from an exhausted failure', () => {
    expect(evidenceScanDisplayState('scan_failed', true)).toBe('retry_scheduled');
    expect(evidenceScanDisplayState('scan_failed', false)).toBe('failed');
    expect(evidenceScanDisplayState('expired', true)).toBe('failed');
  });

  it('does not reinterpret legacy or infected records', () => {
    expect(evidenceScanDisplayState()).toBeNull();
    expect(evidenceScanDisplayState('infected')).toBeNull();
  });
});
