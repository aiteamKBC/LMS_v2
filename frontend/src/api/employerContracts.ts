import type { EmployerDocumentRow } from './employerPortal';

export type EmployerContract = {
  id: string;
  source: 'lms';
  label: string;
  date: string | null;
  signed: boolean;
  available: boolean;
  document?: EmployerDocumentRow;
};
export type EmployerContractsResponse = {
  contracts: EmployerContract[];
  sources: { lms: 'ready' | 'error' };
};

const base = (employerId: string, kind: string, learnerId: string) =>
  `/learner_api/employer-portal/${employerId}/learner/${kind}/${learnerId}/contracts/`;

export async function fetchEmployerContracts(employerId: string, kind: string, learnerId: string, signal: AbortSignal): Promise<EmployerContractsResponse> {
  const response = await fetch(base(employerId, kind, learnerId), { credentials: 'include', signal });
  if (!response.ok) throw new Error('Could not load contracts. Please try again.');
  return response.json() as Promise<EmployerContractsResponse>;
}
