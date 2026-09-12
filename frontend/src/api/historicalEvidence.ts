import type { LearnerKind } from './learnerDetail';
import { readLearnerJson } from './learnerRead';
import type { Activity } from '@/features/old-otjh/api';

export interface HistoricalEvidenceItem {
  id: string;
  source: 'aptem' | 'audit' | 'uploaded';
  source_id: number | string;
  name: string;
  component_name: string;
  component_id?: number | null;
  category: string;
  status: string;
  date: string | null;
  report_month?: string | null;
  otjh_hours: number;
  ksb_codes: string[];
  has_file: boolean;
  has_report: boolean;
  has_note: boolean;
  replaced: boolean;
  original_has_file: boolean;
  note_preview: string | null;
  activity?: Activity & { month: string };
}
export interface HistoricalEvidenceDetail {
  item: HistoricalEvidenceItem;
  documents: { part: string; name: string; content_type: string | null }[];
  note: string | null;
  feedbacks: { id?: string | number; author?: string; date?: string; message?: string }[];
}
export interface HistoricalDocument {
  url: string;
  download_url: string;
  name: string;
  content_type: string | null;
}
const base = (kind: LearnerKind, learnerId: string) => `/learner_api/evidence/${kind}/${encodeURIComponent(learnerId)}/historical/`;
const itemPath = (kind: LearnerKind, learnerId: string, item: HistoricalEvidenceItem) => `${base(kind, learnerId)}${item.source}/${encodeURIComponent(item.source_id)}/`;

export async function fetchHistoricalEvidence(kind: LearnerKind, learnerId: string, signal?: AbortSignal) {
  const data = await readLearnerJson<{ items: HistoricalEvidenceItem[] }>(base(kind, learnerId), { signal });
  if (!Array.isArray(data.items)) throw new Error('Previous evidence could not be loaded. Please retry.');
  return data.items;
}
export function fetchHistoricalEvidenceDetail(kind: LearnerKind, learnerId: string, item: HistoricalEvidenceItem, signal?: AbortSignal) {
  return readLearnerJson<HistoricalEvidenceDetail>(itemPath(kind, learnerId, item), { signal });
}
export function openHistoricalDocument(kind: LearnerKind, learnerId: string, item: HistoricalEvidenceItem, part: string, signal?: AbortSignal) {
  return readLearnerJson<HistoricalDocument>(`${itemPath(kind, learnerId, item)}open/?part=${encodeURIComponent(part)}`, { signal });
}
