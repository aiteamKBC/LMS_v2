import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CertificateDocument, type CertificateDocumentProps } from './CertificateDocument';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const props: CertificateDocumentProps = {
  title: 'Certificate of Achievement', bodyText: 'Completed the activities for',
  learnerName: 'Example student', programmeName: 'Example course', progressLabel: '80%',
  layoutConfig: { showQr: false, decorationStyle: 'none' },
};

it.each([[12.5, '12h 30m'], [8 + 21 / 3600, '8h 21s'], [0, '0h']])(
  'shows actual OTJ time %s separately from component progress', (hours, label) => {
    render(<CertificateDocument {...props} otjHours={Number(hours)} />);
    expect(screen.getByText('OTJ hours completed:')).toHaveTextContent(String(label));
    expect(screen.getByText('80%')).toBeVisible();
  },
);

it.each([undefined, null, NaN, Infinity, -1])('omits unavailable or invalid OTJ hours (%s)', hours => {
  render(<CertificateDocument {...props} otjHours={hours} />);
  expect(screen.queryByText('OTJ hours completed:')).not.toBeInTheDocument();
  expect(screen.getByText('80%')).toBeVisible();
});

it('respects the hours label and visibility independently of the progress line', () => {
  const { rerender } = render(<CertificateDocument {...props} otjHours={2.5}
    layoutConfig={{ ...props.layoutConfig, showProgress: false, otjHoursLabel: 'Recorded OTJ time' }} />);
  expect(screen.getByText('Recorded OTJ time:')).toHaveTextContent('2h 30m');
  expect(screen.queryByText('80%')).not.toBeInTheDocument();
  rerender(<CertificateDocument {...props} otjHours={2.5}
    layoutConfig={{ ...props.layoutConfig, showOtjHours: false }} />);
  expect(screen.queryByText('2h 30m')).not.toBeInTheDocument();
  expect(screen.getByText('80%')).toBeVisible();
});

it('selects the hours element for editing its label and visibility in the builder', () => {
  const select = vi.fn();
  render(<CertificateDocument {...props} otjHours={12.5} editable onSelectElement={select} />);
  fireEvent.click(screen.getByText('12h 30m'));
  expect(select).toHaveBeenCalledWith('otjHours');
});

it.each(['/verify-certificate/example-token', '/verify-personal-certificate/example-token'])(
  'renders a local QR and opens the same verification link for %s with network requests unavailable', path => {
    const request = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    vi.stubGlobal('fetch', request);
    render(<CertificateDocument {...props} verificationUrl={path}
      layoutConfig={{ ...props.layoutConfig, showQr: true, primaryColor: '#ffffff' }} />);
    const qr = screen.getByRole('img', { name: 'Certificate verification QR code' });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(qr.querySelector('path[fill="#000000"]')).not.toBeNull();
    expect(document.querySelector('img[src*="qrserver"]')).toBeNull();
    fireEvent.click(qr);
    expect(screen.getByRole('link', { name: 'Open verification' })).toHaveAttribute('href', new URL(path, window.location.origin).href);
    expect(screen.getAllByRole('img', { name: 'Certificate verification QR code' })).toHaveLength(2);
    expect(request).not.toHaveBeenCalled();
  },
);

it('updates the encoded QR when switching certificates without retaining an earlier failed image', () => {
  const { rerender } = render(<CertificateDocument {...props} verificationUrl="/verify-certificate/first"
    layoutConfig={{ ...props.layoutConfig, showQr: true }} />);
  const matrix = () => screen.getByRole('img', { name: 'Certificate verification QR code' }).innerHTML;
  const first = matrix();
  rerender(<CertificateDocument {...props} verificationUrl="/verify-certificate/second"
    layoutConfig={{ ...props.layoutConfig, showQr: true }} />);
  expect(matrix()).not.toBe(first);
  fireEvent.click(screen.getByRole('img', { name: 'Certificate verification QR code' }));
  expect(screen.getByRole('link', { name: 'Open verification' })).toHaveAttribute('href', `${window.location.origin}/verify-certificate/second`);
});

it.each([undefined, '', ' ', 'not a verification URL', 'javascript:alert(1)', 'https://'])(
  'shows an explicit unavailable state without inventing a QR for %s', verificationUrl => {
    render(<CertificateDocument {...props} verificationUrl={verificationUrl} layoutConfig={{ ...props.layoutConfig, showQr: true }} />);
    expect(screen.queryByRole('img', { name: 'Certificate verification QR code' })).not.toBeInTheDocument();
    expect(screen.getByText('Verification link unavailable')).toBeVisible();
    expect(screen.queryByText('Scan to verify')).not.toBeInTheDocument();
  },
);

it('keeps the QR visibility control and builder selection', () => {
  const select = vi.fn();
  const { rerender } = render(<CertificateDocument {...props} verificationUrl="/verify-certificate/example" editable onSelectElement={select} />);
  expect(screen.queryByRole('img', { name: 'Certificate verification QR code' })).not.toBeInTheDocument();
  rerender(<CertificateDocument {...props} verificationUrl="/verify-certificate/example" editable onSelectElement={select}
    layoutConfig={{ ...props.layoutConfig, showQr: true }} />);
  fireEvent.click(screen.getByRole('img', { name: 'Certificate verification QR code' }));
  expect(select).toHaveBeenCalledWith('qr');
  expect(screen.queryByRole('link', { name: 'Open verification' })).not.toBeInTheDocument();
});
