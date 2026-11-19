import { useCallback, useEffect, useState } from 'react';
import type { QuizGeneralSettings } from './quizGeneralSettings';
import type { QuizGradeSettings } from './quizGradeSettings';

export interface QuizDefaults {
  general: QuizGeneralSettings;
  grades: QuizGradeSettings;
  revision: number;
}

let csrfToken = '';
async function request(init?: RequestInit): Promise<QuizDefaults> {
  const response = await fetch('/quiz_api/defaults/', {
    credentials: 'same-origin', ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.method === 'PUT' ? { 'X-CSRFToken': csrfToken } : {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load or save quiz defaults.');
  if (!data.general || !Array.isArray(data.grades?.rows) || typeof data.revision !== 'number') {
    throw new Error('The server returned incomplete quiz defaults. Please retry.');
  }
  csrfToken = data.csrfToken || csrfToken;
  return { general: data.general, grades: data.grades, revision: data.revision };
}

export const fetchQuizDefaults = () => request();
export const saveQuizDefaults = (value: QuizDefaults) => request({ method: 'PUT', body: JSON.stringify(value) });

export function useQuizDefaults() {
  const [data, setData] = useState<QuizDefaults | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchQuizDefaults().then(value => { if (!cancelled) setData(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load quiz defaults.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version]);
  return { data, setData, error, loading, reload };
}

export function formatQuizResult(grade: number, settings?: QuizGradeSettings | null) {
  const percentage = Math.round(grade * 1000) / 10;
  if (!settings) return `${percentage}%`;
  const row = [...settings.rows].sort((left, right) => right.min - left.min).find(item => percentage >= item.min);
  if (settings.resultDisplay === 'percentage') return `${percentage}%`;
  if (settings.resultDisplay === 'points') return row ? `${row.point} grade points` : `${percentage}%`;
  if (settings.resultDisplay === 'grade' && row) return row.grade;
  return row ? `${row.grade} (${percentage}%)` : `${percentage}%`;
}
