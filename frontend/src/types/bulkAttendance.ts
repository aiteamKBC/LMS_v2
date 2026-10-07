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
}

export interface Group {
  id: string;
  name: string;
  cohortId: string;
}

export interface Module {
  id: string;
  name: string;
  programmeId: string;
}

export interface Lecture {
  id: string;
  name: string;
  moduleId: string;
  sessionDate: string;
}

export interface Learner {
  id: string;
  name: string;
  email: string;
  programmeId: string;
  cohortId: string;
  groupId: string;
  endDate: string;
}

