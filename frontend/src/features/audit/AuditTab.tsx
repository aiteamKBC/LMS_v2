import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { fetchLearnerAudit, type AuditJsonValue, type AuditRow, type LearnerAuditResponse } from './api';
import { EmptyState } from '@/pages/users/components/ui';
import { formatDisplayDate, type CaseFileTabProps } from '@/pages/coach/learner-case-file/data';

interface AuditEvidenceItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  date: string;
  component: string;
  content: string;
  feedback: string;
  reportUrl: string;
  noteBlob: string;
  raw: AuditRow;
}

const DATE_KEYS = ['UpdatedDate', 'CompletedDate', 'SubmissionDate', 'created_date', 'SubmittedDate', 'date'];
const TITLE_KEYS = ['EvidenceName', 'name', 'title', 'component', 'ComponentTitle'];

export default function AuditTab({ data }: CaseFileTabProps) {
  const [audit, setAudit] = useState<LearnerAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchLearnerAudit(data.learnerId, data.displayName)
      .then((payload) => {
        if (!cancelled) setAudit(payload);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load audit data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.learnerId, data.displayName]);

  const evidenceItems = useMemo(() => normalizeEvidence(audit?.evidence || []), [audit]);
  const acceptedCount = evidenceItems.filter((item) => item.status.toLowerCase().includes('accept')).length;
  const evidenceDates = evidenceItems.map((item) => item.date).filter((date) => date !== '--');
  const latestDate = evidenceDates
    .map((date) => ({ date, time: new Date(date).getTime() }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((left, right) => right.time - left.time)[0]?.date;

  const handleExportPdf = () => {
    if (!audit) return;
    setExporting(true);
    try {
      downloadAuditPdf(data, audit, evidenceItems);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon="ri-file-search-line" label="Audit Items" value={String(evidenceItems.length || audit?.learner?.evidence_count || '--')} tone="primary" />
        <StatCard icon="ri-check-double-line" label="Accepted" value={String(acceptedCount || '--')} tone="emerald" />
        <StatCard icon="ri-calendar-event-line" label="Latest Evidence" value={latestDate ? formatDisplayDate(latestDate, true) : '--'} tone="amber" />
        <StatCard icon="ri-database-2-line" label="Source Tables" value={String(audit ? 1 + Object.keys(audit.related).length : '--')} tone="accent" />
      </section>

      <section className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
        <div className="flex flex-col gap-3 border-b border-background-200 bg-background-100/50 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground-900">
              <i className="ri-shield-check-line text-primary-500"></i> Audit Evidence Pack
            </h2>
            <p className="mt-1 text-[11px] text-foreground-500">
              Live data from fetching_evidence, prepared for learner and coach sign-off.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!audit || loading || exporting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground-950 px-4 py-2.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-foreground-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <i className={`${exporting ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-line'} text-sm`}></i>
            Export PDF
          </button>
        </div>

        <div className="p-5 md:p-6">
          {loading ? (
            <EmptyState text="Loading audit evidence..." />
          ) : error ? (
            <EmptyState text={error} />
          ) : !audit?.learner ? (
            <EmptyState text="No fetching_evidence learner_evidence row was found for this learner." />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoPanel title="Learner Record" rows={summaryRows(audit.learner)} />
              <InfoPanel title="Programme Dates" rows={dateRows(audit.learner)} />
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
        <div className="flex items-center justify-between border-b border-background-200 bg-background-100/50 px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground-900">
            <i className="ri-timeline-view text-accent-500"></i> Evidence Timeline
          </h2>
          <span className="text-[11px] text-foreground-400">{evidenceItems.length} item(s)</span>
        </div>
        <div className="p-5 md:p-6">
          {loading ? (
            <EmptyState text="Loading evidence items..." />
          ) : evidenceItems.length === 0 ? (
            <EmptyState text="No evidence array was returned in the evidence column." />
          ) : (
            <div className="space-y-3">
              {evidenceItems.map((item) => (
                <div key={item.id} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
                      <i className="ri-file-list-3-line text-base"></i>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground-900">{item.title}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(item.status)}`}>
                          {item.status || 'Unknown'}
                        </span>
                        {item.kind && (
                          <span className="rounded-full border border-background-200 bg-background-50 px-2 py-0.5 text-[10px] font-medium text-foreground-500">
                            {item.kind}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-foreground-500">
                        {item.component || 'Evidence'} - {formatDisplayDate(item.date)}
                      </p>
                      {item.content && <p className="mt-2 text-[12px] leading-5 text-foreground-700">{shorten(item.content, 320)}</p>}
                      {item.feedback && (
                        <p className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-800">
                          {shorten(item.feedback, 280)}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        {item.reportUrl && <LinkPill href={item.reportUrl} label="Assessment report" />}
                        {item.noteBlob && <span className="rounded-full bg-background-50 px-2.5 py-1 text-foreground-500 ring-1 ring-background-200">{item.noteBlob}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {audit && (
        <section className="overflow-hidden rounded-xl border border-foreground-200/60 bg-background-50">
          <div className="border-b border-background-200 bg-background-100/50 px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground-900">
              <i className="ri-table-line text-secondary-500"></i> Related Tables
            </h2>
          </div>
          <div className="space-y-4 p-5 md:p-6">
            {Object.entries(audit.related).map(([table, rows]) => (
              <RelatedTable key={table} table={table} rows={rows} matchedBy={audit.meta[table]?.matchedBy} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function normalizeEvidence(rows: AuditRow[]): AuditEvidenceItem[] {
  return rows.map((entry, index) => {
    const raw = asRow(entry.raw) || entry;
    const feedback = firstFeedback(entry);
    return {
      id: String(valueFrom(entry, ['id']) || valueFrom(raw, ['Id']) || index),
      title: cleanText(valueFrom(entry, TITLE_KEYS) || valueFrom(raw, TITLE_KEYS) || `Evidence ${index + 1}`),
      kind: cleanText(valueFrom(entry, ['kind']) || valueFrom(raw, ['HourType']) || ''),
      status: cleanText(valueFrom(entry, ['status', 'LatestStatus', 'ConfirmedStatus']) || valueFrom(raw, ['LatestStatus', 'ConfirmedStatus']) || ''),
      date: cleanText(valueFrom(entry, DATE_KEYS) || valueFrom(raw, DATE_KEYS) || ''),
      component: cleanText(valueFrom(entry, ['component', 'Component']) || valueFrom(raw, ['ComponentId', 'Component']) || ''),
      content: cleanText(valueFrom(entry, ['content', 'EvidenceName']) || valueFrom(raw, ['EvidenceName']) || ''),
      feedback,
      reportUrl: cleanText(valueFrom(entry, ['assessment_report_url', 'report_url']) || valueFrom(raw, ['report_url']) || ''),
      noteBlob: cleanText(valueFrom(entry, ['note_blob', 'report_blob']) || ''),
      raw,
    };
  }).sort((left, right) => sortableDate(right.date) - sortableDate(left.date));
}

function firstFeedback(entry: AuditRow) {
  const feedbacks = entry.feedbacks;
  if (!Array.isArray(feedbacks)) return '';
  const first = asRow(feedbacks[0]);
  if (!first) return '';
  return cleanText(valueFrom(first, ['message', 'assessor_status', 'author']) || '');
}

function asRow(value: AuditJsonValue | undefined): AuditRow | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AuditRow : null;
}

function valueFrom(row: AuditRow, keys: string[]) {
  const lookup = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const key of keys) {
    const actual = lookup.get(key.toLowerCase());
    if (actual && row[actual] !== null && row[actual] !== undefined && row[actual] !== '') return row[actual];
  }
  return '';
}

function cleanText(value: AuditJsonValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function shorten(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function sortableDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function summaryRows(row: AuditRow) {
  return [
    ['Learner ID', cleanText(valueFrom(row, ['learner_id']))],
    ['Full name', cleanText(valueFrom(row, ['full_name']))],
    ['Programme', cleanText(valueFrom(row, ['program_name']))],
    ['Evidence count', cleanText(valueFrom(row, ['evidence_count']))],
    ['Fetched at', formatDisplayDate(cleanText(valueFrom(row, ['fetched_at'])))],
  ];
}

function dateRows(row: AuditRow) {
  return [
    ['Programme start', formatDisplayDate(cleanText(valueFrom(row, ['program_start_date'])))],
    ['Last date in learning', formatDisplayDate(cleanText(valueFrom(row, ['last_date_in_learning'])))],
    ['Expected return', formatDisplayDate(cleanText(valueFrom(row, ['expected_return_date'])))],
    ['Bill documents', String(Array.isArray(row.bill_documents) ? row.bill_documents.length : 0)],
  ];
}

function InfoPanel({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
      <h3 className="mb-3 text-[12px] font-semibold text-foreground-900">{title}</h3>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 border-b border-background-200 pb-2 last:border-0 last:pb-0">
            <span className="text-[11px] text-foreground-400">{label}</span>
            <span className="text-right text-[12px] font-medium text-foreground-900">{value || '--'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelatedTable({ table, rows, matchedBy }: { table: string; rows: AuditRow[]; matchedBy?: string | null }) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold text-foreground-900">{table}</h3>
        <span className="text-[10px] text-foreground-400">{rows.length} row(s){matchedBy ? ` - matched by ${matchedBy}` : ''}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-foreground-400">No learner-matched rows returned.</p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 3).map((row, index) => (
            <div key={`${table}-${index}`} className="rounded-lg bg-background-50 p-3 text-[11px] text-foreground-600 ring-1 ring-background-200">
              {Object.entries(row).slice(0, 6).map(([key, value]) => (
                <p key={key} className="truncate"><span className="font-semibold text-foreground-800">{key}:</span> {shorten(cleanText(value), 140) || '--'}</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkPill({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-full bg-primary-50 px-2.5 py-1 font-semibold text-primary-700 ring-1 ring-primary-100">
      {label}
    </a>
  );
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('accept') || normalized.includes('confirm')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (normalized.includes('reject') || normalized.includes('refer')) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function StatCard({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: 'primary' | 'emerald' | 'amber' | 'accent' }) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-700',
    accent: 'bg-secondary-100 text-secondary-700',
  } as const;
  return (
    <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-4">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}

const PDF_MARGIN = 14;
const PDF_WIDTH = 210;
const PDF_HEIGHT = 297;
const PDF_CONTENT = PDF_WIDTH - PDF_MARGIN * 2;

function ensurePdfSpace(doc: jsPDF, y: number, needed: number) {
  if (y + needed <= PDF_HEIGHT - PDF_MARGIN) return y;
  doc.addPage();
  return PDF_MARGIN;
}

function addPdfText(doc: jsPDF, text: string, y: number, options: { size?: number; bold?: boolean; color?: [number, number, number]; width?: number } = {}) {
  const size = options.size || 10;
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const color = options.color || [17, 24, 39];
  doc.setTextColor(color[0], color[1], color[2]);
  const lines = doc.splitTextToSize(text || '--', options.width || PDF_CONTENT) as string[];
  const yStart = ensurePdfSpace(doc, y, lines.length * 5 + 2);
  doc.text(lines, PDF_MARGIN, yStart);
  return yStart + Math.max(6, lines.length * 5);
}

function addPdfDivider(doc: jsPDF, y: number) {
  const nextY = ensurePdfSpace(doc, y, 3);
  doc.setDrawColor(226, 232, 240);
  doc.line(PDF_MARGIN, nextY, PDF_WIDTH - PDF_MARGIN, nextY);
  return nextY + 5;
}

function downloadAuditPdf(data: CaseFileTabProps['data'], audit: LearnerAuditResponse, evidenceItems: AuditEvidenceItem[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const generatedAt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  let y = PDF_MARGIN;

  y = addPdfText(doc, 'Learner Audit Evidence Pack', y, { size: 18, bold: true });
  y = addPdfText(doc, `Generated ${generatedAt}`, y, { color: [107, 114, 128] });
  y = addPdfDivider(doc, y);

  y = addPdfText(doc, 'Learner Summary', y, { size: 12, bold: true });
  [
    `Name: ${data.displayName}`,
    `Learner ID: ${audit.learnerId}`,
    `Programme: ${data.programme || cleanText(valueFrom(audit.learner || {}, ['program_name'])) || '--'}`,
    `Cohort / Group: ${data.cohort || '--'} / ${data.group || '--'}`,
    `Coach: ${data.coachName || '--'}`,
    `Evidence count: ${evidenceItems.length}`,
  ].forEach((line) => {
    y = addPdfText(doc, line, y);
  });

  if (audit.learner) {
    y = addPdfDivider(doc, y);
    y = addPdfText(doc, 'Programme Dates', y, { size: 12, bold: true });
    dateRows(audit.learner).forEach(([label, value]) => {
      y = addPdfText(doc, `${label}: ${value || '--'}`, y);
    });
  }

  y = addPdfDivider(doc, y);
  y = addPdfText(doc, 'Evidence Timeline', y, { size: 12, bold: true });
  if (evidenceItems.length === 0) {
    y = addPdfText(doc, 'No evidence items were returned in the evidence column.', y, { color: [75, 85, 99] });
  } else {
    evidenceItems.forEach((item, index) => {
      y = ensurePdfSpace(doc, y, 32);
      y = addPdfText(doc, `${index + 1}. ${item.title}`, y, { bold: true });
      y = addPdfText(doc, `Date: ${formatDisplayDate(item.date)} | Status: ${item.status || '--'} | Type: ${item.kind || '--'}`, y);
      if (item.component) y = addPdfText(doc, `Component: ${item.component}`, y);
      if (item.content) y = addPdfText(doc, `Evidence: ${shorten(item.content, 700)}`, y, { color: [75, 85, 99] });
      if (item.feedback) y = addPdfText(doc, `Feedback: ${shorten(item.feedback, 500)}`, y, { color: [6, 95, 70] });
      if (item.reportUrl) y = addPdfText(doc, `Report URL: ${item.reportUrl}`, y, { color: [79, 70, 229] });
      y += 2;
    });
  }

  y = addPdfDivider(doc, y + 2);
  y = addPdfText(doc, 'Signatures', y, { size: 12, bold: true });
  y = ensurePdfSpace(doc, y + 8, 38);
  doc.setDrawColor(148, 163, 184);
  doc.line(PDF_MARGIN, y + 12, PDF_MARGIN + 78, y + 12);
  doc.line(PDF_MARGIN + 104, y + 12, PDF_MARGIN + 182, y + 12);
  y = addPdfText(doc, 'Learner signature / date', y + 18, { width: 78, color: [75, 85, 99] });
  doc.text('Coach signature / date', PDF_MARGIN + 104, y - 6);

  doc.save(`audit-evidence-${pdfFileNameSegment(data.displayName)}-${audit.learnerId}.pdf`);
}

function pdfFileNameSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'learner';
}
