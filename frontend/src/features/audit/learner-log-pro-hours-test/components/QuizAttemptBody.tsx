// @ts-nocheck -- imported TanStack Router app uses strictNullChecks; the host LMS does not.
//
// One learner's graded quiz attempt, merged by the Last_audit API from the
// shared quiz definition and this Aptem learner's result row. Shared by the
// activity detail page and the activity ledger.
import { useQuery } from "@tanstack/react-query";
import { getQuizAttempt } from "@/features/audit/learner-log-pro-hours-test/lib/api";

// Colour a quiz status chip by pass/fail status.
function scoreClass(status: string | null) {
  const value = (status || "").toLowerCase();
  if (value === "passed") return "bg-success/15 text-success";
  if (value === "failed") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
}

export function QuizBody({ aptemId, learnerName, component }: {
  aptemId?: number;
  learnerName: string;
  component: string | number;
}) {
  const query = useQuery({
    queryKey: ["last-audit-quiz-attempt", aptemId, String(component)],
    queryFn: () => getQuizAttempt({ aptemId: aptemId!, component: String(component) }),
    enabled: Boolean(aptemId && component),
  });
  if (query.isLoading) return <p className="px-4 py-3 text-xs text-muted-foreground">Loading quiz…</p>;
  if (query.isError) return <p className="px-4 py-3 text-xs text-destructive">Could not load the quiz body.</p>;
  if (query.data?.state === "not_quiz") return null;
  if (query.data?.state === "not_attempted") {
    return (
      <div className="px-4 py-4">
        <p className="text-sm font-medium text-foreground">Quiz not attempted</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {learnerName || "This learner"} has not attempted this quiz. Questions, correct answers and solutions are intentionally hidden.
        </p>
      </div>
    );
  }
  const attempt = query.data?.attempt;
  if (!attempt) return <p className="px-4 py-3 text-xs text-muted-foreground">No graded attempt is available.</p>;
  const questions = attempt.quiz_body?.questions ?? [];
  const total = questions.length;
  const correct = questions.filter((q) => q.is_correct).length;
  const percent = attempt.maximum_score && attempt.score != null
    ? Math.round((attempt.score / attempt.maximum_score) * 100)
    : total ? Math.round((correct / total) * 100) : null;
  return (
    <div className="space-y-3 px-4 py-3">
      {/* Score header — the pass/fail status and the derived percentage. */}
      <div className="flex flex-wrap items-center gap-2">
        {attempt.status && (
          <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${scoreClass(attempt.status)}`}>{attempt.status}</span>
        )}
        {percent != null && (
          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{percent}%</span>
        )}
        {attempt.attempt_number > 0 && <span className="text-xs text-muted-foreground">Attempt {attempt.attempt_number}</span>}
        <span className="text-xs text-muted-foreground">{correct}/{total} correct</span>
      </div>
      {questions.map((question, qi) => (
        <div key={question.question_id ?? qi} className="rounded-md border border-border bg-background/40 p-3">
          <p className="text-sm leading-6 text-foreground">
            <span className="mr-1.5 font-semibold text-muted-foreground">Q{question.question_order ?? qi + 1}.</span>
            {question.question_text}
            <span className={`ml-2 text-xs font-semibold ${question.is_correct ? "text-success" : "text-destructive"}`}>
              {question.is_correct ? "✓ correct" : "✗ incorrect"}
            </span>
          </p>
          <ul className="mt-2 space-y-1">
            {(question.answer_options ?? []).map((option, oi) => (
              <li
                key={oi}
                className={`flex items-start gap-2 rounded-sm px-2 py-1 text-sm ${
                  option.is_correct
                    ? "bg-success/10 text-foreground"
                    : option.is_selected
                    ? "bg-destructive/10 text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <span className="mt-0.5 shrink-0 text-xs">
                  {option.is_correct ? "✓" : option.is_selected ? "✗" : "•"}
                </span>
                <span>
                  {option.option_text}
                  {option.is_selected && <span className="ml-1.5 text-xs font-medium text-muted-foreground">(learner's answer)</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
