import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReviewInstanceFormDefinition } from '@/api/reviewInstances';
import { ReviewSignatures } from '../ReviewSignatures';

// A synthetic PNG fixture; never substitute a generated image for saved evidence.
const savedMark = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZcAAAAASUVORK5CYII=';
function signatures(): ReviewInstanceFormDefinition['signatures'] {
  return {
    advisor: { required: true, signed: false },
    participant: { required: true, signed: true, signature: savedMark, signedName: 'Sample Learner', signedAt: '2026-09-14T15:38:56.023831' },
    employer: { required: false, signed: false },
    referrer: { required: false, signed: false },
  };
}
afterEach(cleanup);

describe('Saved review signature evidence', () => {
  it('shows the original saved learner mark, identity and London signing time alongside the pending coach', () => {
    render(<ReviewSignatures signatures={signatures()} />);
    expect(screen.getByRole('img', { name: 'Learner signature' })).toHaveAttribute('src', savedMark);
    expect(screen.getByText('Sample Learner')).toBeVisible();
    expect(screen.getByText('Signed 14 Sept 2026, 16:38 (Europe/London)')).toBeVisible();
    expect(screen.getByText('1 of 2 required signatures saved')).toBeVisible();
    const coach = screen.getByRole('article', { name: 'Coach signature' });
    expect(within(coach).getByText('Awaiting signature')).toBeVisible();
    expect(within(coach).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Employer signature' })).not.toBeInTheDocument();
  });

  it.each([null, 'signed', 'https://example.test/signature.png', 'data:image/svg+xml;base64,PHN2Zy8+'])('does not invent a replacement mark for unavailable or unsupported saved evidence (%s)', signature => {
    const state = signatures();
    state.participant.signature = signature;
    render(<ReviewSignatures signatures={state} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('A signature is recorded, but its image is unavailable.')).toBeVisible();
    expect(screen.getByText('Sample Learner')).toBeVisible();
    expect(screen.getByText('1 of 2 required signatures saved')).toBeVisible();
  });

  it('never presents an unsigned stored field as a completed signature', () => {
    const state = signatures();
    state.participant.signed = false;
    render(<ReviewSignatures signatures={state} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Sample Learner')).not.toBeInTheDocument();
    expect(screen.getByText('0 of 2 required signatures saved')).toBeVisible();
  });

  it('keeps the recorded identity but reports an image that cannot be decoded', () => {
    render(<ReviewSignatures signatures={signatures()} />);
    fireEvent.error(screen.getByRole('img', { name: 'Learner signature' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('A signature is recorded, but its image is unavailable.')).toBeVisible();
    expect(screen.getByText('Sample Learner')).toBeVisible();
  });

  it('shows both saved signatures and completion after the final required party signs', () => {
    const state = signatures();
    state.advisor = { required: true, signed: true, signature: savedMark, signedName: 'Sample Coach', signedAt: '2026-09-14T16:00:00Z' };
    render(<ReviewSignatures signatures={state} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('2 of 2 required signatures saved')).toBeVisible();
    expect(screen.getByText('All required signatures are saved.')).toBeVisible();
    expect(screen.queryByText('Awaiting signature')).not.toBeInTheDocument();
  });

  it('does not present a fabricated signing date for missing or malformed metadata', () => {
    const state = signatures();
    state.participant.signedAt = 'invalid';
    render(<ReviewSignatures signatures={state} />);
    expect(screen.getByText('Signing date not recorded')).toBeVisible();
  });

  it('does not show a signature requirement when the template has none', () => {
    const state = signatures();
    Object.values(state).forEach(value => { value.required = false; });
    render(<ReviewSignatures signatures={state} />);
    expect(screen.queryByRole('region', { name: 'Review signatures' })).not.toBeInTheDocument();
  });
});
