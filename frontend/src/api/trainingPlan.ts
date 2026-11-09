// ============================================================================
// Shared structured training-plan shape, persisted on Commercial_users.
// Training_plan and Enrolment_Users.Learning_plan. Ids are curriculum
// module_authoring_* primary keys, carried through so the backend (OTJH/KSB
// lookups) and any future consumer can match exactly instead of by title.
// ============================================================================

export interface TrainingPlanComponent {
  componentId: string;
  componentTitle: string;
}
export interface TrainingPlanWeek {
  weekId: string;
  weekTitle: string;
  components: TrainingPlanComponent[];
}
export interface TrainingPlanModule {
  moduleId: string;
  moduleTitle: string;
  weeks: TrainingPlanWeek[];
}
export type TrainingPlan = TrainingPlanModule[];

// A free course assigned to a learner. Deliberately NOT part of TrainingPlan:
// free courses are a pure assignment record with no hours, KSBs or progress, so
// the backend stores them in Learner.learner_free_courses and never feeds them
// into OTJH or the KSB snapshot. `addedAt` remains a compatibility field; the
// canonical assignment table does not store an assignment timestamp.
export interface FreeCourseAssignment {
  freeCourseId: string;
  courseName: string;
  addedAt?: string;
  /** Assignment retained for staff review when its canonical course is absent. */
  unavailable?: boolean;
}
