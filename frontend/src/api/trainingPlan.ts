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
