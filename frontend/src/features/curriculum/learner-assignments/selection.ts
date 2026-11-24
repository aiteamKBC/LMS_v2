import type { AssignmentLearner, LearnerAssignmentTarget } from '@/api/curriculumLearnerAssignments';

export type Tab = 'available' | 'assigned';

export function assignmentOptions(learners: AssignmentLearner[]) {
  const values = (key: 'programme' | 'company' | 'programmeStatus') =>
    [...new Set(learners.map(learner => learner[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { programmes: values('programme'), companies: values('company'), statuses: values('programmeStatus') };
}

export function assignmentCohortOptions(learners: AssignmentLearner[], programme: string) {
  return [...new Set(learners
    .filter(learner => !programme || learner.programme === programme)
    .map(learner => learner.cohort).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function assignmentFilter({ query, programme, company, cohort, status, target }: {
  query: string;
  programme: string;
  company: string;
  cohort: string;
  status: string;
  target: Pick<LearnerAssignmentTarget, 'scope'>;
}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (learner: AssignmentLearner) => {
    const name = `${learner.name} ${learner.email}`.toLocaleLowerCase();
    return terms.every(term => name.includes(term))
      && (!programme || learner.programme === programme)
      && (target.scope === 'module' ? (!cohort || learner.cohort === cohort) : (!company || learner.company === company))
      && (!status || learner.programmeStatus === status);
  };
}

export function toggleIn(set: Set<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
