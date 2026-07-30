export interface ReportMetric {
  label: string;
  value: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface ReportTable {
  headers: string[];
  rows: string[][];
}

export interface ReportChart {
  type: 'bar' | 'line' | 'stacked';
  labels: string[];
  datasets: { label: string; values: number[]; color: string }[];
}

export interface ReportSection {
  title: string;
  content?: string;
  metrics?: ReportMetric[];
  table?: ReportTable;
  chart?: ReportChart;
  findings?: string[];
  recommendations?: string[];
  approval?: {
    checklistLabel: string;
    actions: Array<{
      label: string;
      kind: 'download-pdf' | 'workflow';
    }>;
  };
}

export interface GeneratedReport {
  id: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  period: string;
  coach: string;
  sections: ReportSection[];
}
