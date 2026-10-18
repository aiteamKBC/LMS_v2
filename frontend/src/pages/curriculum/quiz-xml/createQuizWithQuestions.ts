/** Submit the complete generated quiz to the server's atomic creation path. */
export async function createQuizWithQuestions<T>(payload: Record<string, unknown> & { initialQuestions: unknown[] }): Promise<T> {
  const response = await fetch('/quiz_api/quizzes/create-with-questions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const created = await response.json().catch(() => null);
  if (!response.ok) throw new Error(created?.error || 'Could not create quiz');
  if (!created || !Number.isInteger(created.id)) throw new Error('The server did not return a saved quiz.');
  return created as T;
}
