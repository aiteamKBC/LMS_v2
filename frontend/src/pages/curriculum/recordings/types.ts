import type { LibraryRecording } from '@/api/sessionResults';

export type RecordingStatus = "ready" | "review" | "pending" | "missing" | "unsynced" | "archiveFailed" | "upcoming" | "inProgress" | "cancelled" | "planned" | "unavailable";

export type RecordingFilter = "all" | "ready" | "attention";

export interface Recording {
  id: string;
  label: string;
  status: RecordingStatus;
  /** Present only when a saved file genuinely exists. */
  durationLabel?: string;
  sizeLabel?: string;
  note?: string;
  source: LibraryRecording;
}

export interface Lecture {
  id: string;
  moduleId: string;
  title: string;
  /** ISO calendar date in the viewing browser's time zone. */
  date: string;
  startTime: string;
  endTime: string;
  programme: string;
  cohort: string;
  group: string;
  module: string;
  week: number | null;
  weekTitle: string;
  archived: boolean;
  programmeActive: boolean;
  joinUrl?: string;
  source?: 'occurrence' | 'authored' | 'recording-review';
  status: RecordingStatus;
  statusReason?: string;
  recordings: Recording[];
}

export interface LectureActionPayload {
  lecture: Lecture;
  recording: Recording;
}
