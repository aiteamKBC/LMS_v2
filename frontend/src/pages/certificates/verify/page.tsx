import { useEffect, useMemo, useState } from 'react';
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
  const programme = learner?.programme || certificate?.snapshot?.programme || 'Programme not recorded';
  const verificationUrl = useMemo(() => {
    if (typeof window === 'undefined') return `/verify-certificate/${token}`;
    return `${window.location.origin}/verify-certificate/${token}`;
  }, [token]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-primary-50/40 px-6 py-10 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-3 text-sm font-black text-primary-700">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-700 text-white">KBC</span>
            Kent Business College
          </Link>
          <span className="rounded-full border border-primary-100 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-primary-700 shadow-sm">
            Certificate verification
          </span>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
          <div className="bg-gradient-to-r from-primary-900 via-primary-700 to-primary-300 p-8 text-white">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-white/70">Verification result</p>
            <h1 className="mt-3 text-4xl font-black">{loading ? 'Checking certificate…' : error ? 'Certificate not verified' : 'Certificate verified'}</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold text-white/80">
              This page confirms whether a certificate was issued by Kent Business College through the LMS certificate system.
            </p>
          </div>

          <div className="p-8">
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

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <FieldCard label="Learner" value={learner?.name || 'Learner not recorded'} />
                  <FieldCard label="Programme" value={programme} />
                  <FieldCard label="Certificate number" value={certificate.certificateNumber} />
                  <FieldCard label="Issued date" value={formatDate(certificate.issuedAt)} />
                  <FieldCard label="Progress" value={`${certificate.progressPercent}%`} />
                  <FieldCard label="Template version" value={`Version ${certificate.templateVersion}`} />
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-inner">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Official certificate</p>
                      <p className="mt-1 text-sm font-semibold text-slate-600">Rendered from the certificate snapshot issued by the LMS.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="rounded-xl bg-primary-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-primary-700/20"
                    >
                      Print / save PDF
                    </button>
                  </div>
                  <CertificateDocument
                    title={title}
                    bodyText={bodyText}
                    learnerName={learner?.name || 'Learner'}
                    programmeName={programme}
                    progressLabel={`${certificate.progressPercent}%`}
                    certificateNumber={certificate.certificateNumber}
                    awardedOn={formatDate(certificate.issuedAt)}
                    verificationUrl={verificationUrl}
                    layoutConfig={layoutConfig}
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Verification link</p>
                  <p className="mt-2 break-all text-sm font-semibold text-slate-700">{verificationUrl}</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
