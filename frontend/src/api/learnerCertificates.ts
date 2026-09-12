import { readLearnerJson } from './learnerRead';
import type { CertificateTemplate } from './platformAdmin';

export interface LearnerCertificateEligibility {
  eligible: boolean;
  missing: string[];
  progressPercent: number;
  minimumProgress: number;
  trackableDone: number;
  trackableTotal: number;
  finalTestPassed: boolean;
  learner: {
    id: string;
    kind: string;
    name: string;
    email: string;
    programme: string;
    cohort: string;
    group: string;
    employer: string;
  };
}

export interface LearnerCertificate {
  id: number;
  certificateNumber: string;
  templateId: number;
  templateVersion: number;
  progressPercent: number;
  snapshot: {
    certificateTitle?: string;
    bodyText?: string;
    layoutConfig?: CertificateTemplate['layoutConfig'];
    learner?: LearnerCertificateEligibility['learner'];
    programme?: string;
    progressPercent?: number;
    minimumProgress?: number;
    finalTestPassed?: boolean;
  };
  issuedAt: string | null;
  pdfBlobUrl: string;
  verificationToken: string;
  verificationUrl: string;
}

export interface LearnerCertificateStatus {
  configured: boolean;
  template: CertificateTemplate | null;
  certificate: LearnerCertificate | null;
  eligibility?: LearnerCertificateEligibility;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error((data && data.error) || `Request failed (${response.status})`);
  }
  return data as T;
}

export async function fetchLearnerCertificateTemplate(kind: string, id: number | string) {
  return readLearnerJson<{ configured: boolean; template: CertificateTemplate | null }>(`/learner_api/certificates/${kind}/${id}/template/`);
}

export async function fetchLearnerCertificateStatus(kind: string, id: number | string) {
  return readLearnerJson<LearnerCertificateStatus>(`/learner_api/certificates/${kind}/${id}/`);
}

export async function issueLearnerCertificate(kind: string, id: number | string) {
  const response = await fetch(`/learner_api/certificates/${kind}/${id}/issue/`, {
    method: 'POST',
    credentials: 'include',
  });
  return readJson<LearnerCertificateStatus & { issued: boolean }>(response);
}
