export type QuizAttemptMode = 'unlimited' | 'limited';
export type QuizStyle = 'default' | 'pagination' | 'global';

export interface QuizGeneralSettings {
  attemptMode: QuizAttemptMode;
  attemptLimit: number;
  attemptHistory: boolean;
  retakeAfterPass: boolean;
  quizStyle: QuizStyle;
}


export const defaultQuizGeneralSettings: QuizGeneralSettings = {
  attemptMode: 'unlimited',
  attemptLimit: 3,
  attemptHistory: true,
  retakeAfterPass: true,
  quizStyle: 'pagination',
};
