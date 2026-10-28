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
  programmeId?: string;
  moduleIds?: string[];
}

export interface Module {
  id: string;
  rosterId?: string;
  name: string;
  programmeId: string;
  programmeName?: string;
  cohortId?: string;
  cohortName?: string;
  groupId?: string;
  groupName?: string;
}

export interface Lecture {
  id: string;
  name: string;
  sessionNumber?: number;
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
  /** LMS enrolment email when it differs from the KBC directory email. */
  lmsEmail?: string;
  programme?: string;
  group?: string;
  cohort?: string;
  programmeId: string;
  cohortId: string;
  groupId: string;
  endDate: string;
  /** LMS enrolment status, or the KBC status for learners not enrolled. */
  status?: string;
  /** Saved delivery mode; absent preferences are represented as live. */
  attendanceMode?: "live" | "lazy";
}

