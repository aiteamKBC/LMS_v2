import { useState } from 'react';
import type { FeedbackSection } from '@/api/feedback';
import { parsePostLectureQuestionBank, POST_LECTURE_BANK_TEMPLATE, questionBankAnswerLabel, type ParsedPostLectureBank } from './postLectureQuestionBank';
import { scoringQuestions } from './scorePreview';

export function QuestionBankImport({ locked, onApply, fixedQuestions = false }: { locked: boolean; onApply: (sections: FeedbackSection[]) => void; fixedQuestions?: boolean }) {
  const [preview, setPreview] = useState<ParsedPostLectureBank | null>(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [closingKey, setClosingKey] = useState('');
  const [closingSectionIndex, closingQuestionIndex] = closingKey.split(':').map(Number);
  const selectedClosing = closingKey ? preview?.sections[closingSectionIndex]?.questions[closingQuestionIndex] : undefined;
  const categories = preview?.sections.slice(0, preview.categoryCount).map((section, sectionIndex) => {
    const questions = section.questions.filter((_, questionIndex) => !selectedClosing || sectionIndex !== closingSectionIndex || questionIndex !== closingQuestionIndex);
    return { ...section, questions, questionsPerDelivery: fixedQuestions ? null : Math.min(section.questionsPerDelivery ?? questions.length, questions.length) };
  }) || [];
  const fixedClosing = preview?.closingQuestion ? preview.sections.at(-1) : selectedClosing ? {
    title: 'General comments', icon: 'ri-chat-3-line', description: '', questionsPerDelivery: null, questions: [selectedClosing],
  } : null;
  const configuredSections = [...categories.filter(section => section.questions.length), ...(fixedClosing ? [fixedClosing] : [])];
  const perLecture = configuredSections.reduce((count, section) => count + (section.questionsPerDelivery ?? section.questions.length), 0);
  const incompleteScores = scoringQuestions(configuredSections).filter(entry => entry.readiness.state === 'incomplete').length;
  const writtenQuestions = preview?.sections.slice(0, preview.categoryCount).flatMap((section, sectionIndex) => section.questions.flatMap((question, questionIndex) => question.type === 'long_text' ? [{ key: `${sectionIndex}:${questionIndex}`, text: question.text, category: section.title }] : [])) || [];

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(['\uFEFF', POST_LECTURE_BANK_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fixedQuestions ? 'feedback-question-bank-template.csv' : 'live-sessions-feedback-question-bank-template.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function readFile(file: File | undefined) {
    setPreview(null);
    setError('');
    setNotice('');
    setClosingKey('');
    setFileName(file?.name || '');
    if (!file) return;
    setBusy(true);
    try {
      setPreview(await parsePostLectureQuestionBank(file, { fixedQuestions }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read question bank.');
    } finally {
      setBusy(false);
    }
  }

  function setDrawCount(index: number, count: number) {
    setPreview(current => current ? {
      ...current,
      sections: current.sections.map((section, position) => position === index ? { ...section, questionsPerDelivery: count } : section),
    } : null);
  }

  function apply() {
    if (!preview || locked) return;
    onApply(configuredSections);
    setPreview(null);
    setNotice('Question bank added to this draft. Save the form to keep it.');
  }

  return <section aria-label="Question bank import" className="rounded-xl border border-primary-100 bg-white p-4 md:col-span-2">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-foreground-900">Upload question bank</h3><p className="mt-1 text-xs text-foreground-500">Download the template, fill in your questions, then upload it here.</p></div>
      <a href={`${import.meta.env.BASE_URL}templates/post-lecture-question-bank.xlsx`} download={fixedQuestions ? 'feedback-question-bank.xlsx' : 'live-sessions-feedback-question-bank.xlsx'} className="rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700">Download Excel template</a>
    </div>
    <p className="mt-3 text-xs leading-5 text-foreground-600">Fill in <strong>Category</strong>, <strong>Question</strong> and <strong>Answer type</strong>. Choose the answer type from the Excel dropdown. For choice questions, fill in <strong>Option 1</strong>, <strong>Option 2</strong>, and so on. Leave those columns empty for stars or written answers.</p>
    <p className="mt-2 text-xs leading-5 text-foreground-500">Set <strong>Option 1 score</strong>, <strong>Option 2 score</strong>, and so on from 0 to 100. For Yes / No, use <strong>Yes score</strong> and <strong>No score</strong>. For Number, set <strong>Score min</strong>, <strong>Score max</strong> and <strong>Scoring</strong> (Higher is better or Lower is better). Stars use their scale automatically. Blank scores need setup before publishing; 0 is a real score.</p>
    <p className="mt-2 text-xs leading-5 text-foreground-500">Optional: Importance defaults to Medium. Include in overall score can be Yes or No; excluded questions still need their own scores. The template also supports Required, Help text and rating labels. Written answers have no automatic score. {fixedQuestions ? 'All questions are fixed for this form; there is no random selection.' : 'Draw counts are still chosen once per category below.'}</p>
    <details className="mt-3 rounded-lg bg-background-50 p-3 text-xs text-foreground-600">
      <summary className="cursor-pointer font-semibold text-primary-700">Using an existing file?</summary>
      <p className="mt-2 leading-5">Previous Excel and CSV formats are still supported. {fixedQuestions ? 'Questions per lecture values are ignored for this form. Every imported question is included.' : 'You do not need a Questions per lecture column; choose the numbers after uploading.'}</p>
      <button type="button" onClick={downloadTemplate} className="mt-2 font-semibold text-primary-700">Download CSV template</button>
    </details>
    <label className="mt-4 block text-xs font-semibold text-foreground-700">Question bank file<input type="file" accept=".xlsx,.csv" disabled={locked || busy} className="mt-1.5 w-full rounded-lg border border-foreground-200/70 bg-white px-3 py-2 text-sm disabled:bg-background-100" onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {locked && <p className="mt-2 text-xs text-amber-700">This form structure is locked because responses have started. Import into a new editable template instead.</p>}
    {busy && <p role="status" className="mt-3 text-xs text-foreground-500">Reading question bank...</p>}
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
    {preview && <div className="mt-4 space-y-3 rounded-xl border border-primary-200 bg-primary-50/30 p-4">
      <div><p className="text-xs font-semibold text-foreground-900">Preview: {fileName} — {preview.questionCount} questions across {preview.categoryCount} categories</p><p className="mt-1 text-xs text-foreground-500">{fixedQuestions ? 'All questions (fixed): every question in each category will appear in the form.' : 'Choose the number from each category once. A new selection is picked automatically for each lecture and stays the same when a learner reopens it.'}</p></div>
      {!fixedQuestions && !preview.closingQuestion && writtenQuestions.length > 0 && <label className="block rounded-lg bg-white p-3 text-xs font-semibold text-foreground-700">Fixed closing question (optional)<select aria-label="Fixed closing question" disabled={locked} className="mt-2 w-full rounded-lg border border-foreground-200 px-3 py-2 text-sm" value={closingKey} onChange={event => setClosingKey(event.target.value)}><option value="">None — keep written answers in their categories</option>{writtenQuestions.map(question => <option key={question.key} value={question.key}>{question.category}: {question.text}</option>)}</select><span className="mt-2 block font-normal text-foreground-500">This question always appears last and is not part of the random draw.</span></label>}
      <div className="grid gap-3 sm:grid-cols-2">{categories.map((section, index) => <div key={section.title} className="rounded-lg border border-primary-100 bg-white p-3">
        <div className="flex items-start justify-between gap-2"><h4 className="text-sm font-semibold text-foreground-900">{section.title}</h4><span className="shrink-0 rounded-full bg-primary-50 px-2 py-1 text-[10px] font-semibold text-primary-700">{section.questions.length} in bank</span></div>
        <p className="mt-1 break-words text-[11px] text-foreground-500">{section.questions.length ? [...new Set(section.questions.map(questionBankAnswerLabel))].join(' · ') : 'Only the fixed closing question is in this category.'}</p>
        {fixedQuestions ? <p className="mt-3 text-xs font-semibold text-primary-700">All questions (fixed)</p> : <label className="mt-3 block text-xs font-semibold text-foreground-700">Questions per lecture<select aria-label={`Questions per lecture: ${section.title}`} disabled={locked || !section.questions.length} className="mt-1 w-full rounded-lg border border-foreground-200 bg-white px-3 py-2 text-sm disabled:bg-background-100" value={section.questionsPerDelivery ?? section.questions.length} onChange={event => setDrawCount(index, Number(event.target.value))}>
          {!section.questions.length && <option value={0}>No questions to draw</option>}
          {section.questions.map((_, position) => <option key={position + 1} value={position + 1}>{position + 1 === section.questions.length ? `All ${position + 1} questions (fixed)` : `${position + 1} random ${position ? 'questions' : 'question'}`}</option>)}
        </select></label>}
      </div>)}</div>
      {fixedClosing && <p className="rounded-lg bg-white p-3 text-xs text-foreground-700"><span className="font-semibold">Fixed closing question:</span> {fixedClosing.questions[0].text}</p>}
      <p aria-live="polite" className="text-sm font-semibold text-primary-800">{fixedQuestions ? `This form: ${perLecture} questions (all fixed)` : `Each lecture: ${perLecture} questions`}</p>
      {incompleteScores > 0 && <p role="status" className="text-xs text-amber-800">{incompleteScores} {incompleteScores === 1 ? 'question needs' : 'questions need'} scoring setup before publishing. You can add this bank and finish its scores in the editor.</p>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={locked} onClick={apply} className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Replace draft questions with this bank</button><button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-foreground-200 bg-white px-3 py-2 text-xs font-semibold text-foreground-600">Cancel import</button></div>
      <p className="text-xs text-foreground-500">Applying this bank replaces the current draft questions. Save the form separately; previous {fixedQuestions ? 'form' : 'lecture'} responses stay unchanged.</p>
    </div>}
  </section>;
}
