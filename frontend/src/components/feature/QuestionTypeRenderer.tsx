export type RenderableQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'matching'
  | 'image_matching'
  | 'keywords'
  | 'fill_gap'
  | 'ordering';

export interface RenderableAnswer {
  id: number | string;
  text: string;
  isCorrect: boolean;
}

interface QuestionAnswersViewProps {
  type: RenderableQuestionType;
  answers: RenderableAnswer[];
  className?: string;
  compact?: boolean;
  showCorrect?: boolean;
  fallbackText?: string;
}

const answerLetter = (index: number) => String.fromCharCode(65 + index);

const correctClass = 'border-emerald-300 bg-[#ecfdf5] text-emerald-900 shadow-[inset_3px_0_0_#10b981]';
const neutralClass = 'border-[#dbe3ee] bg-[#f8fafc] text-[#111827]';

function splitPair(value: string) {
  const parts = value.split(/\s*(?:->|=>|=)\s*/);
  if (parts.length < 2) {
    return { left: value, right: '' };
  }

  return {
    left: parts[0].trim(),
    right: parts.slice(1).join(' -> ').trim(),
  };
}

function fallbackItems(value = '') {
  const cleaned = value.includes('|') ? value.split('|').slice(1).join('|') : value;
  return cleaned
    .split(/\s*(?:;|\n)\s*/)
    .map(item => item.trim())
    .filter(Boolean);
}

function SectionLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#f4f1ff] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#5b2dbb]">
      <i className={icon}></i>
      {label}
    </div>
  );
}

function CorrectMark({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 shrink-0">
      <i className="ri-check-line"></i>
      Correct
    </span>
  );
}

function ChoiceAnswers({ answers, type, compact, showCorrect }: QuestionAnswersViewProps) {
  const isTrueFalse = type === 'true_false';
  const isMultiple = type === 'multiple_choice';

  return (
    <div>
      {(isMultiple || isTrueFalse) && (
        <p className="mb-3 text-xs font-medium text-[#647083]">
          {isMultiple ? 'Multiple answers can be correct.' : 'True or false format.'}
        </p>
      )}
      <div className={`grid grid-cols-1 ${isTrueFalse ? 'sm:grid-cols-2' : compact ? 'lg:grid-cols-1' : 'lg:grid-cols-2'} gap-3`}>
        {answers.map((answer, answerIndex) => {
          const isCorrect = showCorrect && answer.isCorrect;

          return (
            <div
              key={answer.id}
              className={`min-w-0 rounded-xl border px-3 sm:px-4 py-3 text-sm leading-6 flex items-start sm:items-center gap-3 transition-smooth ${isCorrect ? correctClass : neutralClass}`}
            >
              {isMultiple ? (
                <span className={`w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-semibold shrink-0 ${isCorrect ? 'border-emerald-400 bg-white text-emerald-700' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                  {isCorrect ? <i className="ri-checkbox-fill text-lg"></i> : <i className="ri-checkbox-blank-line text-lg"></i>}
                </span>
              ) : (
                <span className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-semibold shrink-0 ${isCorrect ? 'border-emerald-400 bg-white text-emerald-700' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                  {answerLetter(answerIndex)}
                </span>
              )}
              {isMultiple && <span className="text-xs font-bold text-[#64748b] shrink-0">{answerLetter(answerIndex)}</span>}
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{answer.text}</span>
              <CorrectMark visible={Boolean(isCorrect)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KeywordAnswers({ answers, showCorrect }: QuestionAnswersViewProps) {
  return (
    <div className="rounded-2xl border border-[#dbe3ee] bg-[#fbfcff] p-4">
      <SectionLabel icon="ri-key-2-line" label="Accepted keywords" />
      <div className="flex flex-wrap gap-2">
        {answers.map((answer, index) => {
          const isCorrect = showCorrect && answer.isCorrect;
          return (
            <span
              key={answer.id}
              className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium ${isCorrect ? 'border-emerald-300 bg-[#ecfdf5] text-emerald-800' : 'border-[#dbe3ee] bg-white text-[#475569]'}`}
            >
              <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-bold shrink-0 ${isCorrect ? 'border-emerald-400 bg-white text-emerald-700' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                {index + 1}
              </span>
              <span className="truncate">{answer.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function FillGapAnswer({ answers }: QuestionAnswersViewProps) {
  const answer = answers.find(item => item.isCorrect) || answers[0];

  return (
    <div className="rounded-2xl border border-emerald-300 bg-[#ecfdf5] p-4 shadow-[inset_3px_0_0_#10b981]">
      <SectionLabel icon="ri-pencil-ruler-2-line" label="Correct gap answer" />
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <span className="inline-flex w-fit rounded-xl border border-dashed border-emerald-400 bg-white px-4 py-2 text-sm font-semibold text-emerald-900">
          {answer?.text || 'No answer saved'}
        </span>
        <span className="text-xs text-emerald-700">This is the expected text for the blank.</span>
      </div>
    </div>
  );
}

function MatchingAnswers({ answers, type }: QuestionAnswersViewProps) {
  const isImage = type === 'image_matching';

  return (
    <div className="rounded-2xl border border-[#dbe3ee] bg-[#fbfcff] p-4">
      <SectionLabel icon={isImage ? 'ri-image-line' : 'ri-link-m'} label={isImage ? 'Image matches' : 'Matched pairs'} />
      <div className="grid grid-cols-1 gap-3">
        {answers.map((answer, index) => {
          const pair = splitPair(answer.text);

          return (
            <div key={answer.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] items-stretch gap-2">
              <div className="rounded-xl border border-[#dbe3ee] bg-white px-3 py-3 text-sm text-[#111827] break-words [overflow-wrap:anywhere]">
                <span className="mr-2 inline-flex w-6 h-6 rounded-full border border-[#cbd5e1] items-center justify-center text-[11px] font-bold text-[#64748b]">{answerLetter(index)}</span>
                {pair.left}
              </div>
              <span className="hidden sm:flex items-center justify-center text-[#5b2dbb]">
                <i className="ri-arrow-right-line text-xl"></i>
              </span>
              <div className="rounded-xl border border-emerald-300 bg-[#ecfdf5] px-3 py-3 text-sm font-medium text-emerald-900 break-words [overflow-wrap:anywhere]">
                {isImage && <i className="ri-image-line mr-2 text-emerald-700"></i>}
                {pair.right || pair.left}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderingAnswers({ answers }: QuestionAnswersViewProps) {
  return (
    <div className="rounded-2xl border border-[#dbe3ee] bg-[#fbfcff] p-4">
      <SectionLabel icon="ri-sort-asc" label="Correct sequence" />
      <div className="space-y-3">
        {answers.map((answer, index) => (
          <div key={answer.id} className="relative flex gap-3">
            {index < answers.length - 1 && <span className="absolute left-4 top-9 h-6 w-px bg-[#dbe3ee]"></span>}
            <span className="w-8 h-8 rounded-full bg-[#5b2dbb] text-white flex items-center justify-center text-xs font-bold shrink-0">{index + 1}</span>
            <div className="min-w-0 flex-1 rounded-xl border border-[#dbe3ee] bg-white px-4 py-3 text-sm text-[#111827] break-words [overflow-wrap:anywhere]">
              {answer.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuestionAnswersView({ type, answers, className = '', compact = false, showCorrect = true, fallbackText = '' }: QuestionAnswersViewProps) {
  const fallbackAnswers = answers.length === 0 && ['matching', 'image_matching', 'keywords'].includes(type)
    ? fallbackItems(fallbackText).map((text, index) => ({ id: `fallback-${index}`, text, isCorrect: true }))
    : [];
  const displayAnswers = answers.length ? answers : fallbackAnswers;

  if (displayAnswers.length === 0) {
    return null;
  }

  const props = { type, answers: displayAnswers, compact, showCorrect };

  return (
    <div className={`min-w-0 ${className}`}>
      {type === 'keywords' ? (
        <KeywordAnswers {...props} />
      ) : type === 'fill_gap' ? (
        <FillGapAnswer {...props} />
      ) : type === 'matching' || type === 'image_matching' ? (
        <MatchingAnswers {...props} />
      ) : type === 'ordering' ? (
        <OrderingAnswers {...props} />
      ) : (
        <ChoiceAnswers {...props} />
      )}
    </div>
  );
}
