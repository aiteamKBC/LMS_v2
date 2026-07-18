import { useCallback, useEffect, useState } from 'react';

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

const STORAGE_KEY = 'kbc.quiz.gradeSettings';
const CHANGE_EVENT = 'kbc-quiz-grade-settings-change';

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

function normalizeSettings(value: unknown): QuizGradeSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<QuizGradeSettings> : {};
  const rows = Array.isArray(candidate.rows) && candidate.rows.length
    ? candidate.rows.map(row => ({
      grade: String(row.grade || '').trim() || 'Grade',
      point: Number.isFinite(Number(row.point)) ? Number(row.point) : 0,
      min: Math.max(0, Math.min(100, Math.round(Number(row.min) || 0))),
      color: /^#[0-9a-f]{6}$/i.test(String(row.color || '')) ? String(row.color) : '#5b2dbb',
    }))
    : defaultQuizGradeRows;

  return {
    resultDisplay: candidate.resultDisplay || defaultQuizGradeSettings.resultDisplay,
    scoreSeparator: candidate.scoreSeparator || defaultQuizGradeSettings.scoreSeparator,
    coursePageDisplay: candidate.coursePageDisplay || defaultQuizGradeSettings.coursePageDisplay,
    rows,
  };
}

export function getQuizGradeSettings(): QuizGradeSettings {
  if (typeof window === 'undefined') return defaultQuizGradeSettings;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeSettings(JSON.parse(stored)) : defaultQuizGradeSettings;
  } catch {
    return defaultQuizGradeSettings;
  }
}

export function saveQuizGradeSettings(settings: QuizGradeSettings) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeSettings(settings);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: normalized }));
}

export function formatQuizGradeRange(rows: QuizGradeRow[], rowIndex: number) {
  const row = rows[rowIndex];
  if (!row) return '';
  const max = rowIndex === 0 ? 100 : Math.max(row.min, rows[rowIndex - 1].min - 1);
  return `${row.min}-${max}%`;
}

export function useQuizGradeSettings() {
  const [settings, setSettingsState] = useState<QuizGradeSettings>(() => getQuizGradeSettings());

  useEffect(() => {
    const handleChange = () => setSettingsState(getQuizGradeSettings());
    window.addEventListener('storage', handleChange);
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => {
      window.removeEventListener('storage', handleChange);
      window.removeEventListener(CHANGE_EVENT, handleChange);
    };
  }, []);

  const setSettings = useCallback((nextSettings: QuizGradeSettings) => {
    const normalized = normalizeSettings(nextSettings);
    setSettingsState(normalized);
    saveQuizGradeSettings(normalized);
  }, []);

  return [settings, setSettings] as const;
}
