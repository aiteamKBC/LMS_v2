export type AttendanceStatus = "present" | "absent" | "unmarked";

export interface Programme {
  id: string;
  name: string;
  code: string;
}

export interface Cohort {
  id: string;
  name: string;
  programmeId: string;
  startDate: string;
  endDate?: string;
}

export interface Group {
  id: string;
  name: string;
  cohortId: string;
}

export interface Module {
  id: string;
  rosterId?: string;
  name: string;
  programmeId: string;
  cohortId?: string;
  groupId?: string;
}

export interface Lecture {
  id: string;
  name: string;
  moduleId: string;
  moduleCatalogueId?: string;
  moduleName?: string;
  moduleAliases?: string[];
  /** Curriculum placement used to constrain the register by its session date. */
  programmeId?: string;
  cohortId?: string;
  groupId?: string;
  sessionDate: string;
}

export interface Learner {
  id: string;
  kbcId?: string;
  curriculumId?: string;
  name: string;
  email: string;
  programme?: string;
  group?: string;
  cohort?: string;
  programmeId: string;
  cohortId: string;
  groupId: string;
  endDate: string;
  /** LMS enrolment status, or the KBC status for learners not enrolled. */
  status?: string;
}

