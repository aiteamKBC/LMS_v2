import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CertificateDocument } from '@/components/feature/CertificateDocument';
import type { CertificateTemplate } from '@/api/platformAdmin';

interface VerificationCertificate {
  certificateNumber: string;
  templateVersion: number;
  progressPercent: number;
  snapshot?: {
    certificateTitle?: string;
    bodyText?: string;
    layoutConfig?: CertificateTemplate['layoutConfig'];
    learner?: {
      name?: string;
      programme?: string;
      email?: string;
    };
    programme?: string;
    moduleTitle?: string;
    moduleRef?: string;
    minimumProgress?: number;
    finalTestPassed?: boolean;
  };
  issuedAt: string | null;
  verificationToken: string;
}

interface VerificationResponse {
  valid: boolean;
  certificate: VerificationCertificate;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function FieldCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-base font-black text-slate-950">{value}</p>
    </div>
  );
}

export default function CertificateVerificationPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<VerificationResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const pdfSourceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/learner_api/certificates/verify/${encodeURIComponent(token)}/`, { credentials: 'omit' })
      .then(async (response) => {
        const text = await response.text();
        const payload = text ? JSON.parse(text) : null;
        if (!response.ok) {
          throw new Error((payload && payload.error) || `Verification failed (${response.status})`);
        }
        return payload as VerificationResponse;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Certificate could not be verified.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const certificate = data?.certificate;
  const learner = certificate?.snapshot?.learner;
  const title = certificate?.snapshot?.certificateTitle || 'Certificate of Achievement';
  const bodyText = certificate?.snapshot?.bodyText || 'has successfully completed the requirements and passed the LMS final examination for';
  const layoutConfig = certificate?.snapshot?.layoutConfig || {};
  const moduleTitle = certificate?.snapshot?.moduleTitle || '';
  const programme = learner?.programme || certificate?.snapshot?.programme || '';
  const awardTarget = moduleTitle || programme || 'Programme not recorded';
  const awardTargetLabel = moduleTitle ? 'Module' : 'Programme';
  const verificationUrl = useMemo(() => {
    if (typeof window === 'undefined') return `/verify-certificate/${token}`;
    return `${window.location.origin}/verify-certificate/${token}`;
  }, [token]);

  const downloadCertificatePdf = async () => {
    if (!certificate || !pdfSourceRef.current || pdfBusy) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      const [{ toPng }, { jsPDF }] = await Promise.all([
        import('html-to-image'),
        import('jspdf'),
      ]);
      const image = await toPng(pdfSourceRef.current, {
        backgroundColor: '#ffffff',
        cacheBust: true,
        pixelRatio: 2,
      });
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      pdf.addImage(image, 'PNG', 0, 0, 297, 210);
      pdf.save(`${filenameSafe(certificate.certificateNumber)}.pdf`);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Could not generate the certificate PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <main className="certificate-verify-page min-h-screen bg-gradient-to-br from-slate-50 via-white to-primary-50/40 px-6 py-10 text-slate-950">
      <style>
        {`
          @media print {
            @page {
              size: A4 landscape;
              margin: 0;
            }

            html,
            body,
            #root {
              width: 100% !important;
              height: 100% !important;
              margin: 0 !important;
              overflow: hidden !important;
              background: #fff !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            .certificate-verify-page {
              min-height: 0 !important;
              padding: 0 !important;
              background: #fff !important;
            }

            .certificate-screen-content {
              display: none !important;
            }

            #certificate-print-area {
              position: fixed !important;
              inset: 0 !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              width: 100% !important;
              height: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
              background: #fff !important;
              break-after: avoid !important;
              break-before: avoid !important;
              break-inside: avoid !important;
              page-break-after: avoid !important;
              page-break-before: avoid !important;
              page-break-inside: avoid !important;
            }

            #certificate-print-area .certificate-print-document {
              width: 267mm !important;
              max-width: 267mm !important;
              border: 0 !important;
              border-radius: 0 !important;
              box-shadow: none !important;
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
          }

          @media screen {
            #certificate-print-area {
              display: none !important;
            }
          }

          @media screen and (max-width: 640px) {
            .certificate-verify-page {
              padding: 1rem 0.75rem !important;
            }

            .certificate-screen-content {
              max-width: 100% !important;
            }

            .certificate-verify-panel {
              border-radius: 1.25rem !important;
            }

            .certificate-verify-hero,
            .certificate-verify-body {
              padding: 1rem !important;
            }

            .certificate-preview-card {
              padding: 0.75rem !important;
              border-radius: 1.25rem !important;
            }

            .certificate-preview-shell {
              margin-inline: -0.25rem;
              overflow: hidden;
            }
          }
        `}
      </style>
      <div className="certificate-screen-content mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-3 text-sm font-black text-primary-700">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-700 text-white">KBC</span>
            Kent Business College
          </Link>
          <span className="rounded-full border border-primary-100 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-primary-700 shadow-sm">
            Certificate verification
          </span>
        </div>

        <section className="certificate-verify-panel overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
          <div className="certificate-verify-hero bg-gradient-to-r from-primary-900 via-primary-700 to-primary-300 p-8 text-white">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-white/70">Verification result</p>
            <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">{loading ? 'Checking certificate...' : error ? 'Certificate not verified' : 'Certificate verified'}</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold text-white/80">
              This page confirms whether a certificate was issued by Kent Business College through the LMS certificate system.
            </p>
          </div>

          <div className="certificate-verify-body p-8">
            {loading ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary-100 border-t-primary-700" />
                <p className="mt-4 text-sm font-bold text-slate-600">Checking the verification token…</p>
              </div>
            ) : error ? (
              <div className="rounded-3xl border border-red-100 bg-red-50 p-8 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-100 text-3xl text-red-600">
                  !
                </div>
                <h2 className="mt-4 text-2xl font-black text-red-900">We could not verify this certificate</h2>
                <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>
              </div>
            ) : certificate ? (
              <div className="space-y-6">
                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Valid certificate</p>
                      <h2 className="mt-2 text-3xl font-black text-emerald-950">{title}</h2>
                    </div>
                    <div className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-600/20">
                      Verified
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FieldCard label={awardTargetLabel} value={awardTarget} />
                  <FieldCard label="Certificate number" value={certificate.certificateNumber} />
                  <FieldCard label="Awarded date" value={formatDate(certificate.issuedAt)} />
                  <FieldCard label="Progress" value={`${certificate.progressPercent}%`} />
                </div>

                <div className="certificate-preview-card rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-inner">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Official certificate</p>
                      <p className="mt-1 text-sm font-semibold text-slate-600">Rendered from the certificate record awarded by the LMS.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void downloadCertificatePdf()}
                      disabled={pdfBusy}
                      className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-primary-700/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pdfBusy ? 'Preparing PDF...' : 'Download PDF'}
                    </button>
                  </div>
                  {pdfError ? <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{pdfError}</p> : null}
                  <div ref={pdfSourceRef} className="certificate-preview-shell">
                    <CertificateDocument
                      title={title}
                      bodyText={bodyText}
                      learnerName={learner?.name || 'Learner'}
                      programmeName={awardTarget}
                      progressLabel={`${certificate.progressPercent}%`}
                      certificateNumber={certificate.certificateNumber}
                      awardedOn={formatDate(certificate.issuedAt)}
                      verificationUrl={verificationUrl}
                      layoutConfig={layoutConfig}
                    />
                  </div>
                </div>

              </div>
            ) : null}
          </div>
        </section>
      </div>
      {certificate ? (
        <div id="certificate-print-area" aria-hidden="true">
          <CertificateDocument
            className="certificate-print-document"
            title={title}
            bodyText={bodyText}
            learnerName={learner?.name || 'Learner'}
            programmeName={awardTarget}
            progressLabel={`${certificate.progressPercent}%`}
            certificateNumber={certificate.certificateNumber}
            awardedOn={formatDate(certificate.issuedAt)}
            verificationUrl={verificationUrl}
            layoutConfig={layoutConfig}
          />
        </div>
      ) : null}
    </main>
  );
}

function filenameSafe(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'certificate';
}
