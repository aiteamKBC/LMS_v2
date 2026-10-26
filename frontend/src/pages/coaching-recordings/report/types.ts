export interface AIReportChecklistItem {
  item: string;
  completed: boolean;
}

export interface AIReportEvidence {
  quote?: string;
  speaker?: string | null;
  timecode?: string;
  why_it_matters?: string;
}

export interface AIReportQAMetric {
  metric?: string;
  result?: string;
  rag?: 'Green' | 'Amber' | 'Red' | string | null;
  notes?: string;
  rating_1_to_5?: number | null;
  evidence?: AIReportEvidence[];
}

export interface AIReportAction {
  owner?: string;
  action?: string;
  due?: string;
}

export interface AIReport {
  rag_rating?: 'Green' | 'Amber' | 'Red' | string | null;
  qa_score?: number | null;
  safeguarding_score?: number | null;
  satisfaction?: number | null;
  strengths?: string[];
  concerns?: string[];
  actions?: string[];
  recommendations?: string[];
  checklist?: AIReportChecklistItem[];
  ksb_evidence?: string[];
  learner_feedback?: string | null;
  manager_involvement?: string | null;
  summary?: string | null;
  qa?: AIReportQAMetric[];
  priority_actions?: AIReportAction[];
  executive_summary?: string | null;
  overall_rating?: {
    rag?: 'Green' | 'Amber' | 'Red' | string | null;
    qualitative?: string | null;
    average_rating?: number | null;
    professional_judgement?: string | null;
  };
  duration?: string | null;
  duration_score_1_to_5?: number | null;
  duration_inferred_minutes?: number | null;
  learner?: string | null;
  coach?: string | null;
  employer?: string | null;
  programme?: string | null;
  meeting_type?: string | null;
  session_id?: number | string | null;
  date?: string | null;
}
