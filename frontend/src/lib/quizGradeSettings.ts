export interface QuizGradeRow {
  grade: string;
  point: number;
  min: number;
  color: string;
}

export interface QuizGradeSettings {
  resultDisplay: string;
  scoreSeparator: string;
  coursePageDisplay: string;
  rows: QuizGradeRow[];
}


export const defaultQuizGradeRows: QuizGradeRow[] = [
  { grade: 'A+', point: 5, min: 95, color: '#1d7df2' },
  { grade: 'A', point: 4.5, min: 90, color: '#2148f3' },
  { grade: 'A-', point: 4, min: 85, color: '#1457ee' },
  { grade: 'B+', point: 3.5, min: 80, color: '#10a957' },
  { grade: 'B', point: 3, min: 75, color: '#08a51d' },
  { grade: 'B-', point: 2.5, min: 70, color: '#0aa650' },
  { grade: 'C+', point: 2, min: 65, color: '#ef1717' },
  { grade: 'C', point: 1.5, min: 60, color: '#f20707' },
  { grade: 'C-', point: 1, min: 55, color: '#ef1717' },
  { grade: 'D', point: 0, min: 50, color: '#8f8a8d' },
];

export const defaultQuizGradeSettings: QuizGradeSettings = {
  resultDisplay: 'grade',
  scoreSeparator: '/',
  coursePageDisplay: 'separate_tab',
  rows: defaultQuizGradeRows,
};

export function formatQuizGradeRange(rows: QuizGradeRow[], rowIndex: number) {
  const row = rows[rowIndex];
  if (!row) return '';
  const max = rowIndex === 0 ? 100 : Math.max(row.min, rows[rowIndex - 1].min - 1);
  return `${row.min}-${max}%`;
}
