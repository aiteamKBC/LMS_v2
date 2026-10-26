// Adapted from aiteamKBC/Coaching-Sessions, frontend/src/pages/session-detail/utils/printReport.ts.
// Saved report presentation only; no AI generation or attendance/sign-off inference.
import type { SavedCoachingEvidence } from '@/api/coachingRecordings';
import { parseAIReport } from './aiReport';
import { toBritishEnglish } from './britishEnglish';
import { formatEvidenceTimeRange } from './evidenceTimecode';

function esc(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scoreColor(v: number, good = 75, warn = 50): string {
  return v >= good ? '#059669' : v >= warn ? '#D97706' : '#DC2626';
}
function ragColor(rag: string): string {
  if (rag === 'Green') return '#059669';
  if (rag === 'Amber') return '#D97706';
  if (rag === 'Red') return '#DC2626';
  return '#64748B';
}
function bulletList(items?: string[]): string {
  if (!items?.length) return '<p style="color:#9CA3AF;font-style:italic;font-size:12px">None recorded.</p>';
  return `<ul style="margin:0;padding-left:18px;line-height:1.9;font-size:12px">${items.map((i) => `<li>${esc(toBritishEnglish(i))}</li>`).join('')}</ul>`;
}
const STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#1F2937;background:#F8FAFC;line-height:1.5}
  .page{max-width:860px;margin:0 auto;padding:28px 40px 60px;background:#fff;box-shadow:0 18px 50px -36px rgba(15,23,42,.45)}
  .report-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;margin-bottom:20px;border-bottom:3px solid #7C3AED}
  .report-title{text-align:right}
  .report-title p{font-size:14px;font-weight:700;color:#1F2937}
  .report-title span{display:block;font-size:11px;color:#9CA3AF;margin-top:3px}
  .hero-card{background:#F5F3FF;border:1px solid #DDD6FE;border-radius:12px;padding:20px 24px;margin-bottom:24px}
  .hero-inner{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .hero-name{font-size:22px;font-weight:800;color:#1F2937;margin-bottom:7px}
  .hero-meta{font-size:13px;color:#4B5563;margin-bottom:4px}
  .hero-sub{font-size:12px;color:#6B7280}
  .pill-stack{display:flex;flex-direction:column;gap:6px;flex-shrink:0;text-align:right}
  .footer-row{margin-top:40px;padding-top:14px;border-top:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between}
  .sec{margin-bottom:24px}
  .sec-title{font-size:10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:11px;padding-bottom:7px;border-bottom:1.5px solid #E5E7EB}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  .dtable{width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden}
  .card-row{display:grid;grid-template-columns:repeat(4,1fr);gap:13px}
  .card{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px 10px;text-align:center}
  .card-lbl{font-size:9px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px}
  .score-row{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px}
  .score-box{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:18px;text-align:center}
  .score-num{font-size:28px;font-weight:800}
  .score-sub{font-size:10px;color:#9CA3AF;margin-top:5px}
  .list-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px}
  .list-box{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px 16px}
  .list-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:9px}
  .ksb{display:inline-block;padding:3px 10px;background:#EDE9FE;color:#5B21B6;border-radius:99px;font-size:11px;font-weight:500;margin:2px 3px}
  .quote{background:#F5F3FF;border-left:3px solid #7C3AED;padding:12px 16px;border-radius:0 8px 8px 0;font-style:italic;color:#374151;font-size:13px}
  .ai-report{border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;background:#FFFFFF;margin-top:2px}
  .ai-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 20px;background:#F8FAFC;border-bottom:1px solid #E5E7EB}
  .ai-title{font-size:16px;font-weight:850;color:#111827;margin-bottom:4px}
  .ai-sub{font-size:11px;color:#64748B;line-height:1.55}
  .ai-rag{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 12px;font-size:11px;font-weight:800;border:1px solid #E5E7EB;background:#FFFFFF;white-space:nowrap}
  .ai-scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border-bottom:1px solid #E5E7EB}
  .ai-score{padding:16px 18px;border-right:1px solid #E5E7EB}
  .ai-score:last-child{border-right:0}
  .ai-score-label{font-size:9px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  .ai-score-value{font-size:28px;font-weight:850;line-height:1}
  .ai-score-hint{font-size:10px;color:#94A3B8;margin-top:6px}
  .ai-body{padding:18px 20px 20px}
  .ai-text-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:14px;margin-bottom:16px}
  .ai-note{border:1px solid #E5E7EB;border-radius:10px;background:#FBFDFF;padding:14px 15px;break-inside:avoid}
  .ai-note-title{font-size:10px;font-weight:850;color:#475569;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px}
  .ai-note p{font-size:12px;color:#334155;line-height:1.72}
  .ai-list-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:16px}
  .ai-list-box{border:1px solid #E5E7EB;border-top-width:3px;border-radius:10px;background:#FBFDFF;padding:13px 15px;break-inside:avoid}
  .ai-list-title{font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px}
  .ai-action{display:grid;grid-template-columns:96px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:12px}
  .ai-action:last-child{border-bottom:0}
  .ai-owner{font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:.05em}
  .ai-due{display:inline-block;margin-top:5px;padding:2px 8px;border-radius:999px;background:#EDE9FE;color:#5B21B6;font-size:10px;font-weight:800}
  .ai-qa-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:12px}
  .ai-qa-card{border:1px solid #E5E7EB;border-radius:10px;background:#FFFFFF;padding:12px 13px;break-inside:avoid}
  .ai-qa-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
  .ai-qa-title{font-size:11.5px;font-weight:850;color:#111827;line-height:1.35}
  .ai-qa-pill{border-radius:999px;padding:2px 8px;font-size:9.5px;font-weight:850;background:#F1F5F9;color:#475569;white-space:nowrap}
  .ai-qa-text{font-size:11px;color:#475569;line-height:1.6}
  .ai-quote{margin-top:9px;border-left:3px solid #A78BFA;background:#F8FAFC;padding:8px 10px;color:#64748B;font-size:10.5px;line-height:1.55}
  .chk-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #F3F4F6;font-size:12px}
  .summary-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
  .mini-stat{border:1px solid #E5E7EB;border-radius:8px;background:#fff;padding:11px 12px}
  .mini-label{font-size:9px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px}
  .mini-value{font-size:14px;font-weight:800;color:#111827}
  .empty-note{color:#9CA3AF;font-style:italic;padding:16px;background:#F9FAFB;border-radius:8px;border:1px solid #E5E7EB}
  .transcript-box{background:#F8FAFC;border:1px solid #E5E7EB;border-radius:10px;padding:16px}
  .transcript-block{margin-bottom:10px;padding:11px 14px;border-radius:6px}
  .transcript-note{margin-top:10px;color:#64748B;font-size:11px;line-height:1.55}
  .transcript-link{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:9px 13px;border-radius:8px;background:#7C3AED;color:#fff!important;text-decoration:none;font-size:12px;font-weight:800;cursor:pointer}
  .print-only{display:none}
  .full-transcript{background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px}
  .full-transcript .transcript-block{padding:8px 10px;margin-bottom:7px}
  .full-transcript p{font-size:10.5px!important;line-height:1.48!important}
  .brand-logo{width:205px;height:auto;display:block}
  .topbar-logo{width:128px;height:auto;display:block}
  .topbar{position:fixed;top:0;left:0;right:0;padding:10px 20px;background:#fff;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;z-index:100;gap:12px}
  .btn-pdf{padding:8px 18px;background:#7C3AED;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px}
  .btn-secondary{padding:8px 14px;background:#F5F3FF;color:#5B21B6;border:1px solid #DDD6FE;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer}
  .btn-close{padding:8px 14px;background:#F3F4F6;color:#374151;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer}
  @media print{
    @page{size:A4 portrait;margin:14mm 13mm}
    body{background:#fff;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .topbar{display:none!important}
    .page{max-width:none;margin:0!important;padding:0 2mm 8mm;box-shadow:none}
    .brand-logo{width:174px}
    .report-head{padding-bottom:11px;margin-bottom:17px;border-bottom-width:2.5px}
    .report-title p{font-size:13px!important}
    .report-title span{font-size:9.5px!important;margin-top:2px}
    .hero-card{padding:17px 21px;margin-bottom:20px;border-radius:11px;background:#F7F4FF}
    .hero-name{font-size:20px;margin-bottom:5px}
    .hero-meta{font-size:11.5px;line-height:1.5;margin-bottom:4px}
    .hero-sub{font-size:10.5px}
    .pill-stack span{font-size:9.5px!important;padding:4px 11px!important}
    .sec{margin-bottom:18px;padding-top:0}
    .sec-title{font-size:9px;margin-bottom:8px;padding-bottom:5px;border-bottom-width:1px}
    .grid2{gap:22px}
    .dtable{border-color:#E6EAF0;border-radius:8px;background:#FFFFFF}
    .dtable td{padding-top:6.5px!important;padding-bottom:6.5px!important;font-size:10.2px!important}
    .dtable td:first-child{width:126px!important;color:#64748B!important}
    .card-row{gap:11px}
    .card{padding:13px 10px;border-color:#E5E7EB;background:#FBFDFF;border-radius:9px}
    .card-lbl{font-size:8px;margin-bottom:6px}
    .card p:last-child{font-size:12px!important}
    .summary-strip{gap:10px;margin-bottom:12px;break-inside:auto}
    .mini-stat{padding:10px 12px;border-radius:8px}
    .mini-label{font-size:8px;margin-bottom:4px}
    .mini-value{font-size:12px}
    .footer-row{margin-top:22px;padding-top:11px}
    .empty-note{padding:12px 13px;font-size:10.2px;border-radius:8px}
    .ai-report{border-radius:10px}
    .ai-head{padding:14px 16px;gap:12px}
    .ai-title{font-size:14px;margin-bottom:3px}
    .ai-sub{font-size:9.8px}
    .ai-rag{font-size:9.5px;padding:4px 10px}
    .ai-score{padding:13px 14px}
    .ai-score-label{font-size:8px;margin-bottom:5px}
    .ai-score-value{font-size:23px}
    .ai-score-hint{font-size:8.8px;margin-top:4px}
    .ai-body{padding:14px 16px 16px}
    .ai-text-grid{gap:11px;margin-bottom:13px}
    .ai-note{padding:12px 13px;border-radius:9px}
    .ai-note-title{font-size:8.5px;margin-bottom:6px}
    .ai-note p{font-size:10.5px;line-height:1.58}
    .ai-list-grid{gap:10px;margin-bottom:13px}
    .ai-list-box{padding:11px 13px;border-radius:9px}
    .ai-list-title{font-size:8.5px;margin-bottom:6px}
    .ai-action{grid-template-columns:80px 1fr;gap:8px;padding:6px 0;font-size:10.2px}
    .ai-owner{font-size:8.5px}
    .ai-due{font-size:8.5px;padding:2px 7px}
    .ai-qa-grid{gap:9px;margin-top:10px}
    .ai-qa-card{padding:10px 11px;border-radius:9px}
    .ai-qa-title{font-size:9.8px}
    .ai-qa-pill{font-size:8px;padding:2px 7px}
    .ai-qa-text{font-size:9.5px;line-height:1.52}
    .ai-quote{font-size:8.8px;padding:7px 9px;margin-top:7px}
    .dtable,.card,.score-box,.list-box,.quote{break-inside:avoid}
    .ai-report,.ai-note,.ai-list-box,.ai-qa-card{break-inside:avoid}
    .grid2,.card-row,.score-row,.list-grid{break-inside:avoid}
    .transcript-sec{break-before:page;margin-top:0}
    .transcript-box{padding:12px;border-radius:9px;break-inside:avoid;background:#FBFDFF}
    .transcript-block{padding:10px 12px;margin-bottom:8px;border-radius:8px}
    .transcript-block p{font-size:10.2px!important;line-height:1.55!important}
    .transcript-block p:first-child{font-size:8px!important}
    .transcript-note{font-size:9.2px;line-height:1.45;margin-top:8px}
    .transcript-link{font-size:10px;padding:8px 12px;margin-top:9px;border-radius:7px}
    .transcript-block{break-inside:auto}
    .screen-only{display:none!important}
    .print-only{display:block!important}
    .full-transcript{column-count:2;column-gap:16px;padding:10px}
    .full-transcript .transcript-block{break-inside:avoid}
  }
`;

function secAI(s: { report_ai: unknown; transcript?: string | null }): string {
  const ai = parseAIReport(s.report_ai);
  if (!ai) return `<div class="sec"><p class="sec-title">AI Quality Report</p><p class="empty-note">No AI report available for this session.</p></div>`;

  const scoreBox = (label: string, value: string, color: string, hint: string) => `
    <div class="ai-score">
      <p class="ai-score-label">${label}</p>
      <p class="ai-score-value" style="color:${color}">${value}</p>
      <p class="ai-score-hint">${hint}</p>
    </div>`;

  const scores = [
    scoreBox('RAG Rating', esc(ai.rag_rating ?? 'Not rated'), ragColor(ai.rag_rating ?? ''), 'Overall quality signal'),
    ai.qa_score !== undefined && ai.qa_score !== null
      ? scoreBox('QA Score', String(ai.qa_score), scoreColor(ai.qa_score), 'Out of 100')
      : '',
    ai.safeguarding_score !== undefined && ai.safeguarding_score !== null
      ? scoreBox('Safeguarding', String(ai.safeguarding_score), scoreColor(ai.safeguarding_score), 'Out of 100')
      : '',
    ai.satisfaction !== undefined && ai.satisfaction !== null
      ? scoreBox('Satisfaction', String(ai.satisfaction), scoreColor(ai.satisfaction * 20), 'Out of 5')
      : '',
  ].filter(Boolean).join('');

  const professionalJudgement = ai.overall_rating?.professional_judgement ?? ai.overall_rating?.qualitative;
  const textBlocks = [
    professionalJudgement
      ? `<div class="ai-note"><p class="ai-note-title">Professional Judgement</p><p>${esc(toBritishEnglish(professionalJudgement))}</p></div>`
      : '',
    ai.summary
      ? `<div class="ai-note"><p class="ai-note-title">Executive Summary</p><p>${esc(toBritishEnglish(ai.summary))}</p></div>`
      : '',
  ].filter(Boolean).join('');

  const ksbs = ai.ksb_evidence?.map((e) => `<span class="ksb">${esc(e)}</span>`).join('') ?? '';
  const actions = ai.priority_actions?.length
    ? ai.priority_actions.map((action) => {
      const item = action as typeof action | string;
      const owner = typeof item === 'string' ? 'Unassigned' : item.owner || 'Unassigned';
      const text = typeof item === 'string' ? item : item.action || 'Action not specified';
      const due = typeof item === 'string' ? null : item.due;

      return `
        <div class="ai-action">
          <div>
            <p class="ai-owner">Owner</p>
            <p style="font-weight:800;color:#111827">${esc(owner)}</p>
          </div>
          <div>
            <p style="color:#334155;line-height:1.55">${esc(toBritishEnglish(text))}</p>
            ${due ? `<span class="ai-due">Due: ${esc(due)}</span>` : ''}
          </div>
        </div>`;
    }).join('')
    : bulletList(ai.actions);

  const qaMetrics = ai.qa?.length
    ? ai.qa.map((metric) => {
      const firstEvidence = metric.evidence?.find((item) => item.quote && item.quote !== 'Not evidenced in transcript');
      const evidenceTimeRange = formatEvidenceTimeRange(firstEvidence, s.transcript);
      const rag = metric.rag ? `<span class="ai-qa-pill" style="color:${ragColor(metric.rag)}">${esc(metric.rag)}</span>` : '';
      const rating = metric.rating_1_to_5 !== undefined && metric.rating_1_to_5 !== null
        ? `<span class="ai-qa-pill">${metric.rating_1_to_5}/5</span>`
        : '';
      return `
        <div class="ai-qa-card">
          <div class="ai-qa-top">
            <p class="ai-qa-title">${esc(toBritishEnglish(metric.metric || 'QA metric'))}</p>
            <div>${rag}${rating}</div>
          </div>
          ${metric.result ? `<p class="ai-qa-text">${esc(toBritishEnglish(metric.result))}</p>` : ''}
          ${metric.notes ? `<p class="ai-qa-text" style="margin-top:6px;color:#64748B">${esc(toBritishEnglish(metric.notes))}</p>` : ''}
          ${firstEvidence?.quote ? `<p class="ai-quote">"${esc(firstEvidence.quote)}"${evidenceTimeRange ? `<br /><span style="display:block;margin-top:5px;font-size:8.5px;font-weight:800;color:#94A3B8;text-transform:uppercase">${esc(evidenceTimeRange)}</span>` : ''}</p>` : ''}
        </div>`;
    }).join('')
    : '';

  return `
    <div class="sec"><p class="sec-title">AI Quality Report</p>
      <div class="ai-report">
        <div class="ai-head">
          <div>
            <p class="ai-title">AI Quality Report</p>
            <p class="ai-sub">Coaching quality, safeguarding, transcript evidence, and follow-up actions.</p>
          </div>
          <span class="ai-rag" style="color:${ragColor(ai.rag_rating ?? '')};border-color:${ragColor(ai.rag_rating ?? '')}">${esc(ai.rag_rating ?? 'Not rated')}</span>
        </div>
        ${scores ? `<div class="ai-scores">${scores}</div>` : ''}
        <div class="ai-body">
          ${textBlocks ? `<div class="ai-text-grid">${textBlocks}</div>` : ''}
          <div class="ai-list-grid">
            ${(ai.strengths?.length ?? 0) > 0 ? `<div class="ai-list-box" style="border-top-color:#059669"><p class="ai-list-title" style="color:#059669">Strengths</p>${bulletList(ai.strengths)}</div>` : ''}
            ${(ai.concerns?.length ?? 0) > 0 ? `<div class="ai-list-box" style="border-top-color:#DC2626"><p class="ai-list-title" style="color:#DC2626">Concerns</p>${bulletList(ai.concerns)}</div>` : ''}
            ${(ai.priority_actions?.length ?? 0) > 0 || (ai.actions?.length ?? 0) > 0 ? `<div class="ai-list-box" style="border-top-color:#7C3AED"><p class="ai-list-title" style="color:#7C3AED">Actions</p>${actions}</div>` : ''}
            ${(ai.recommendations?.length ?? 0) > 0 ? `<div class="ai-list-box" style="border-top-color:#D97706"><p class="ai-list-title" style="color:#D97706">Recommendations</p>${bulletList(ai.recommendations)}</div>` : ''}
          </div>
          ${qaMetrics ? `<div class="ai-note" style="margin-bottom:16px"><p class="ai-note-title">QA Metrics</p><div class="ai-qa-grid">${qaMetrics}</div></div>` : ''}
          ${ksbs ? `<div class="ai-note" style="margin-bottom:16px"><p class="ai-note-title">KSB Evidence</p>${ksbs}</div>` : ''}
          ${ai.learner_feedback ? `<div style="margin-bottom:14px"><p class="ai-note-title">Learner Feedback</p><div class="quote">"${esc(toBritishEnglish(ai.learner_feedback))}"</div></div>` : ''}
          ${ai.manager_involvement ? `<div class="ai-note"><p class="ai-note-title">Manager Involvement</p><p>${esc(toBritishEnglish(ai.manager_involvement))}</p></div>` : ''}
        </div>
      </div>
    </div>`;
}


type SavedReport = SavedCoachingEvidence['analyses'][number];
export function buildCoachingAiReport(saved: SavedReport, transcript?: string | null, preview = false): string {
  const ai = parseAIReport(saved.report);
  const name = saved.learnerName || ai?.learner || 'Meeting';
  const logo = new URL('assets/kbc-logo.png', new URL(import.meta.env.BASE_URL, window.location.origin)).toString();
  const responsive = `@media screen and (max-width:600px){.page{padding:14px 12px}.grid2,.ai-text-grid,.ai-list-grid,.ai-qa-grid{grid-template-columns:1fr}.hero-card{padding:14px}.hero-name{font-size:18px}.hero-inner,.ai-head{flex-wrap:wrap}.ai-body{padding:12px}.brand-logo{width:145px}.report-title{text-align:left}.report-head{flex-wrap:wrap;gap:12px}.ai-note,.ai-list-box,.ai-qa-card{min-width:0;overflow-wrap:anywhere}.ai-action{grid-template-columns:70px 1fr}}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${window.location.origin}; base-uri 'none'; form-action 'none'">
    <title>AI Quality Report - ${esc(name)}</title><style>${STYLES}${responsive}
    .ai-note,.ai-qa-card,.ai-list-box,.hero-card{overflow-wrap:anywhere}
    @media print{.ai-report,.ai-body,.ai-note{break-inside:auto}.ai-head,.sec-title,.ai-note-title{break-after:avoid}}
    </style></head><body>
    ${preview ? '' : '<div class="topbar"><strong>Coaching Session report</strong><button id="save-report-pdf" class="btn-pdf">Save as PDF</button></div>'}
    <main class="page" ${preview ? '' : 'style="margin-top:58px"'}>
      <div class="report-head"><img class="brand-logo" src="${esc(logo)}" alt="Kent Business College"><div class="report-title"><p>AI Quality Report</p><span>Saved Coaching Session analysis</span></div></div>
      <div class="hero-card"><div class="hero-inner"><div><h1 class="hero-name">${esc(name)}</h1>
        <p class="hero-meta">${esc(ai?.programme || '')}</p><p class="hero-sub">${esc(ai?.meeting_type || saved.type.replace(/_/g, ' '))}${ai?.coach ? ` · Coach: ${esc(ai.coach)}` : ''}${ai?.date ? ` · ${esc(ai.date)}` : ''}</p></div></div></div>
      ${secAI({ report_ai: saved.report, transcript })}
      <div class="footer-row"><p>Kent Business College - Coaching Session<br>Confidential - authorised personnel only</p></div>
    </main></body></html>`;
}

export function openCoachingReport(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(url, '_blank', 'width=980,height=840,scrollbars=yes,resizable=yes');
  if (!win) { URL.revokeObjectURL(url); return false; }
  win.opener = null;
  win.addEventListener('load', () => {
    win.document.getElementById('save-report-pdf')?.addEventListener('click', () => win.print());
    URL.revokeObjectURL(url);
  }, { once: true });
  win.focus();
  return true;
}
