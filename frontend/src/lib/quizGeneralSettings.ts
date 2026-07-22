import { useCallback, useEffect, useState } from 'react';

export type QuizAttemptMode = 'unlimited' | 'limited';
export type QuizStyle = 'default' | 'pagination' | 'global';

export interface QuizGeneralSettings {
  attemptMode: QuizAttemptMode;
  attemptLimit: number;
  attemptHistory: boolean;
  retakeAfterPass: boolean;
  quizStyle: QuizStyle;
}

const STORAGE_KEY = 'kbc.quiz.generalSettings';
const CHANGE_EVENT = 'kbc-quiz-general-settings-change';

export const defaultQuizGeneralSettings: QuizGeneralSettings = {
  attemptMode: 'unlimited',
  attemptLimit: 3,
  attemptHistory: true,
  retakeAfterPass: true,
  quizStyle: 'pagination',
};

function normalizeSettings(value: unknown): QuizGeneralSettings {
  const candidate = value && typeof value === 'object' ? value as Partial<QuizGeneralSettings> : {};
  const attemptMode: QuizAttemptMode = candidate.attemptMode === 'limited' ? 'limited' : 'unlimited';
  const quizStyle: QuizStyle = ['default', 'pagination', 'global'].includes(String(candidate.quizStyle))
    ? candidate.quizStyle as QuizStyle
    : defaultQuizGeneralSettings.quizStyle;

  return {
    attemptMode,
    attemptLimit: Math.max(1, Math.min(20, Math.round(Number(candidate.attemptLimit) || defaultQuizGeneralSettings.attemptLimit))),
    attemptHistory: candidate.attemptHistory ?? defaultQuizGeneralSettings.attemptHistory,
    retakeAfterPass: candidate.retakeAfterPass ?? defaultQuizGeneralSettings.retakeAfterPass,
    quizStyle,
  };
}

export function getQuizGeneralSettings(): QuizGeneralSettings {
  if (typeof window === 'undefined') return defaultQuizGeneralSettings;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeSettings(JSON.parse(stored)) : defaultQuizGeneralSettings;
  } catch {
    return defaultQuizGeneralSettings;
  }
}

export function saveQuizGeneralSettings(settings: QuizGeneralSettings) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeSettings(settings);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: normalized }));
}

export function useQuizGeneralSettings() {
  const [settings, setSettingsState] = useState<QuizGeneralSettings>(() => getQuizGeneralSettings());

  useEffect(() => {
    const handleChange = () => setSettingsState(getQuizGeneralSettings());
    window.addEventListener('storage', handleChange);
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => {
      window.removeEventListener('storage', handleChange);
      window.removeEventListener(CHANGE_EVENT, handleChange);
    };
  }, []);

  const setSettings = useCallback((nextSettings: QuizGeneralSettings) => {
    const normalized = normalizeSettings(nextSettings);
    setSettingsState(normalized);
    saveQuizGeneralSettings(normalized);
  }, []);

  return [settings, setSettings] as const;
}
