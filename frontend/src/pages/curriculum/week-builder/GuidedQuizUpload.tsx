import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import * as XLSX from 'xlsx';
import { ThemedSelect } from '@/components/feature/ThemedSelect';
import { useToast } from '@/hooks/useToast';

/* ------------------------------------------------------------------ *
 * Guided quiz upload — used inside the week builder's Quiz component.
 * The learner picks a format, is shown exactly how that file must look,
 * then uploads it. The new quiz is created in the Quiz Workspace via
 * quiz_api and handed back so QuizBody can link it to the week.
 * Programme / module come from the week's scope, so they aren't asked
 * for again.
 * ------------------------------------------------------------------ */

type FormatKey = 'csv' | 'excel' | 'xml' | 'scorm';
type XmlShape = 'record' | 'question';
type ValidationLevel = 'ok' | 'warn' | 'error';

interface ValidationResult {
  level: ValidationLevel;
  title: string;
  detail?: string;
  stats?: { label: string; value: string }[];
  shape?: XmlShape;
}

interface QuizScope {
  programmeId: string;
  programmeName: string;
  moduleName: string;
}

interface GuidedQuizUploadProps {
  open: boolean;
  onClose: () => void;
  onUploaded: (quiz: any) => void;
  scope: QuizScope;
}

/* ------------------------------------------------------------------ *
 * Per-format accent + metadata
 * ------------------------------------------------------------------ */

const ACCENT: Record<FormatKey, string> = {
  csv: '#0ea5e9',
  excel: '#22c55e',
  xml: '#8b5cf6',
  scorm: '#f59e0b',
};

interface FormatMeta {
  key: FormatKey;
  label: string;
  icon: string;
  extLabel: string;
  accept: string;
  exts: string[];
  tagline: string;
  peek: string[];
}

const FORMATS: FormatMeta[] = [
  {
    key: 'csv',
    label: 'CSV',
    icon: 'ri-file-list-2-line',
    extLabel: '.csv',
    accept: '.csv',
    exts: ['.csv'],
    tagline: 'A plain spreadsheet export — one question per row.',
    peek: ['question,option_a,…', 'What is paid social?,…'],
  },
  {
    key: 'excel',
    label: 'Excel',
    icon: 'ri-file-excel-2-line',
    extLabel: '.xlsx / .xlsm',
    accept: '.xlsx,.xlsm',
    exts: ['.xlsx', '.xlsm'],
    tagline: 'A workbook with the same columns as CSV.',
    peek: ['A  question_type', 'B  question …'],
  },
  {
    key: 'xml',
    label: 'XML',
    icon: 'ri-code-s-slash-line',
    extLabel: '.xml',
    accept: '.xml',
    exts: ['.xml'],
    tagline: 'Structured tags — Record or Question layout.',
    peek: ['<record>', '  <Question_Title>…'],
  },
  {
    key: 'scorm',
    label: 'SCORM',
    icon: 'ri-folder-zip-line',
    extLabel: '.zip',
    accept: '.zip,.scorm',
    exts: ['.zip', '.scorm'],
    tagline: 'A zipped e-learning package.',
    peek: ['package.zip', '  imsmanifest.xml …'],
  },
];

const FORMAT_BY_KEY: Record<FormatKey, FormatMeta> = FORMATS.reduce((acc, meta) => {
  acc[meta.key] = meta;
  return acc;
}, {} as Record<FormatKey, FormatMeta>);

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'pending', label: 'Pending' },
  { value: 'private', label: 'Private' },
];

/* ------------------------------------------------------------------ *
 * Pin explanations (right-hand rail), keyed per format / shape
 * ------------------------------------------------------------------ */

interface Pin {
  n: number;
  title: string;
  detail: string;
  warn?: boolean;
}

const CSV_PINS: Pin[] = [
  { n: 1, title: 'question_type', detail: 'One of the 8 types. Leave blank for single choice.' },
  { n: 2, title: 'question', detail: 'The question text learners read.' },
  { n: 3, title: 'option_a … option_e', detail: 'Up to five choices. Leave the extra ones empty.' },
  { n: 4, title: 'correct_answer', detail: 'Letter A–E, number 1–5, or exact text. Multiple → A,B.' },
  { n: 5, title: 'quiz_title / programme / module', detail: 'Optional — the week already sets programme and module.' },
  { n: 6, title: 'feedback', detail: 'Optional explanation shown after answering.' },
];

const XML_RECORD_PINS: Pin[] = [
  { n: 1, title: '<record>', detail: 'One block per question.' },
  { n: 2, title: '<Question_Title>', detail: 'The question text.' },
  { n: 3, title: '<Option_1> … <Option_5>', detail: 'Up to five choices.' },
  { n: 4, title: '<Answer>', detail: 'Correct choice: a number (2) or a letter (B).' },
  {
    n: 5,
    title: '<Question_Explanation_N>',
    detail: 'Feedback. The suffix is 0-based: Answer 1 → no suffix, Answer 2 → _1, Answer 3 → _2.',
    warn: true,
  },
  { n: 6, title: '<Course_Name> / <Section_Name>', detail: 'Optional — the week already sets programme / module.' },
];

const XML_QUESTION_PINS: Pin[] = [
  { n: 1, title: '<question type="...">', detail: 'One per question. Supports all 8 LMS question types.' },
  { n: 2, title: '<text>', detail: 'The question (you can also use <stem>).' },
  { n: 3, title: '<option correct="true">', detail: 'For choice and True/False questions. Mark every correct option.' },
  { n: 4, title: 'Type-specific answers', detail: 'Use <pairs>, <acceptedKeywords>, <acceptedAnswers>, or <items> for structured types.' },
  { n: 5, title: '<feedback>', detail: 'Optional explanation.' },
  {
    n: 6,
    title: '<module> / <programme>',
    detail: 'Ignored from <metadata> here — the week already sets programme / module.',
    warn: true,
  },
];

const SCORM_PINS: Pin[] = [
  { n: 1, title: 'imsmanifest.xml', detail: 'Required. Without it the package is rejected.' },
  {
    n: 2,
    title: 'quiz.xml / .json / .txt',
    detail: 'Your questions — the XML shapes above, a course-data JSON, or plain text. The first readable file wins.',
  },
];

/* ------------------------------------------------------------------ *
 * Rules checklists
 * ------------------------------------------------------------------ */

const RULES: Record<string, string[]> = {
  csv: [
    'Row 1 must be the column headers.',
    'One question per row (or use the grouped layout: question_id, question_text, option_text, is_correct).',
    'Wrap any value that contains a comma in "double quotes".',
  ],
  excel: [
    'Row 1 must be the headers — identical columns to CSV.',
    'One question per row on the first sheet.',
    'Save as .xlsx or .xlsm (not .xls).',
  ],
  'xml-record': [
    'Wrap every <record> in a single root element.',
    'Match the tag names exactly — they are case-sensitive.',
    'Mind the 0-based explanation suffix (see pin 5).',
  ],
  'xml-question': [
    'Wrap every <question> in a single root element.',
    'Set type to one of: single_choice, multiple_choice, true_false, matching, image_matching, keywords, fill_gap, ordering.',
    'Use correct="true" for choices and the type-specific answer structure shown in the template for other types.',
    'Programme / module come from this week — no need to set them in the file.',
  ],
  scorm: [
    'The package must be a .zip.',
    'imsmanifest.xml must be present at the top level.',
    'Put questions in a readable .xml, .json, or .txt file inside.',
  ],
};

const ANSWER_CHIPS = ['A', 'B', '1', '2', 'A,B', 'A;C', 'A / C', 'exact text'];

/* ------------------------------------------------------------------ *
 * Downloadable templates
 * ------------------------------------------------------------------ */

const CSV_TEMPLATE = `question_type,question,option_a,option_b,option_c,option_d,option_e,correct_answer,feedback,quiz_title,programme,module
single_choice,"What is paid social?","Organic post","Sponsored content","Employee post","Newsletter","","B","Paid social uses ad spend.","Social Media Quiz","Marketing Exec L4","Organic vs Paid"
multiple_choice,"Which are paid channels?","Meta Ads","Google Ads","Blog post","Organic reel","","A,B","Paid channels use ad spend.","Social Media Quiz","Marketing Exec L4","Organic vs Paid"
`;

const XML_RECORD_TEMPLATE = `<records>
  <record>
    <Quiz_Title>Social Media Quiz</Quiz_Title>
    <Course_Name>Marketing Exec L4</Course_Name>
    <Section_Name>Organic vs Paid</Section_Name>
    <Question_Type>single_choice</Question_Type>
    <Question_Title>What is paid social?</Question_Title>
    <Option_1>Organic post</Option_1>
    <Option_2>Sponsored content</Option_2>
    <Option_3>Employee post</Option_3>
    <Option_4>Newsletter</Option_4>
    <Answer>2</Answer>
    <Question_Explanation_1>Paid social uses advertising spend.</Question_Explanation_1>
  </record>
</records>
`;

export const XML_QUESTION_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
  <metadata>
    <title>All Question Types Quiz</title>
    <module />
    <programme />
  </metadata>
  <questions>
    <question type="single_choice" points="1">
      <text>Which protocol secures web traffic?</text>
      <option correct="false">HTTP</option>
      <option correct="true">HTTPS</option>
      <feedback>HTTPS encrypts browser traffic.</feedback>
    </question>
    <question type="multiple_choice" points="2">
      <text>Select all authentication factors.</text>
      <option correct="true">Something you know</option>
      <option correct="true">Something you have</option>
      <option correct="false">Screen brightness</option>
    </question>
    <question type="true_false" points="1">
      <text>HTTPS encrypts web traffic.</text>
      <option correct="true">True</option>
      <option correct="false">False</option>
    </question>
    <question type="matching" points="2">
      <text>Match each status code to its meaning.</text>
      <pairs>
        <pair><left>200</left><right>OK</right></pair>
        <pair><left>404</left><right>Not Found</right></pair>
      </pairs>
    </question>
    <question type="image_matching" points="2">
      <text>Match each image to its label.</text>
      <pairs>
        <pair>
          <image>https://your-domain.example/circle.png</image>
          <display>Image A</display>
          <right>Circle</right>
        </pair>
      </pairs>
    </question>
    <question type="keywords" points="2">
      <text>Enter two RAG status colours.</text>
      <acceptedKeywords>
        <keyword>red</keyword>
        <keyword>amber</keyword>
      </acceptedKeywords>
    </question>
    <question type="fill_gap" points="1">
      <text>Complete: HTTPS keeps traffic _____.</text>
      <acceptedAnswers>
        <answer>secure</answer>
        <answer>encrypted</answer>
      </acceptedAnswers>
    </question>
    <question type="ordering" points="2">
      <text>Put the actions in the correct order.</text>
      <items>
        <item id="1">Open the quiz</item>
        <item id="2">Answer the questions</item>
        <item id="3">Submit the quiz</item>
      </items>
      <correctOrder>1,2,3</correctOrder>
    </question>
  </questions>
</quiz>
`;

function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// Same columns as the CSV template, written as a genuine .xlsx workbook.
const EXCEL_TEMPLATE_ROWS = [
  ['question_type', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'correct_answer', 'feedback', 'quiz_title', 'programme', 'module'],
  ['single_choice', 'What is paid social?', 'Organic post', 'Sponsored content', 'Employee post', 'Newsletter', '', 'B', 'Paid social uses ad spend.', 'Social Media Quiz', 'Marketing Exec L4', 'Organic vs Paid'],
  ['multiple_choice', 'Which are paid channels?', 'Meta Ads', 'Google Ads', 'Blog post', 'Organic reel', '', 'A,B', 'Paid channels use ad spend.', 'Social Media Quiz', 'Marketing Exec L4', 'Organic vs Paid'],
];

function downloadExcelTemplate() {
  const worksheet = XLSX.utils.aoa_to_sheet(EXCEL_TEMPLATE_ROWS);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Quiz');
  XLSX.writeFile(workbook, 'quiz-template.xlsx', { compression: true });
}

/* ------------------------------------------------------------------ *
 * Client-side validation
 * ------------------------------------------------------------------ */

const MAX_TEXT_PARSE_BYTES = 6 * 1024 * 1024;

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map(cell => cell.replace(/^"|"$/g, '').trim());
}

// CSV and Excel share the same columns, so classification + result shaping is shared.
function classifyQuestionHeaders(headers: string[]) {
  const has = (...names: string[]) => names.some(name => headers.includes(name));
  return {
    grouped: ['question_id', 'question_text', 'option_text', 'is_correct'].every(header => headers.includes(header)),
    rowPerQuestion: has('question', 'question title', 'question_title', 'question text', 'question_text', 'stem'),
    hasOptions: has('option_1', 'option 1', 'option_a', 'option a', 'a'),
  };
}

function headersError(headers: string[]): ValidationResult {
  const found = headers.slice(0, 8).join(', ') + (headers.length > 8 ? '…' : '');
  return {
    level: 'error',
    title: "These columns don't match the template",
    detail: `Couldn't find a question column. Found: ${found || '(no headers)'}. Add a "question" column, or use the grouped layout (question_id, question_text, option_text, is_correct).`,
  };
}

function colIndex(headers: string[], ...names: string[]) {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

function cellAt(row: unknown[], index: number) {
  return index < 0 ? '' : String(row[index] ?? '').trim();
}

function isTruthy(value: unknown) {
  return ['yes', 'true', '1', 'y', 'correct'].includes(String(value ?? '').trim().toLowerCase());
}

function optionIndices(headers: string[]) {
  return headers.reduce<number[]>((acc, header, index) => {
    if (/^(?:option[ _]?(?:[a-e]|[1-5])|[a-e])$/.test(header)) acc.push(index);
    return acc;
  }, []);
}

function tabularResult(label: string, count: number, statLabel: string, problems: string[]): ValidationResult {
  if (problems.length) {
    return {
      level: 'warn',
      title: `${label} — ${problems.length} issue${problems.length === 1 ? '' : 's'} to check`,
      detail: `${problems.join('; ')}. You can still upload, but affected questions may not grade correctly.`,
      stats: [{ label: statLabel, value: String(count) }, { label: 'Issues', value: String(problems.length) }],
    };
  }
  return {
    level: 'ok',
    title: `${label} — ${count} question${count === 1 ? '' : 's'}`,
    detail: 'Columns and answers look complete.',
    stats: [{ label: statLabel, value: String(count) }],
  };
}

// Deep content check shared by CSV and Excel — flags questions with no
// options or no correct answer, not just a missing header row.
function analyzeTabular(kind: string, headers: string[], rows: unknown[][]): ValidationResult {
  const cls = classifyQuestionHeaders(headers);
  if (!cls.grouped && !cls.rowPerQuestion) return headersError(headers);

  const dataRows = rows.filter(row => row.some(cell => String(cell ?? '').trim().length));
  if (!dataRows.length) return { level: 'warn', title: 'Headers look right, but there are no question rows', detail: 'Add at least one row beneath the header.' };

  if (cls.grouped) {
    const idIndex = colIndex(headers, 'question_id', 'id');
    const optionIndex = colIndex(headers, 'option_text', 'answer_text');
    const correctIndex = colIndex(headers, 'is_correct');
    const groups = new Map<string, { correct: number }>();
    for (const row of dataRows) {
      const id = cellAt(row, idIndex);
      if (!id || !cellAt(row, optionIndex)) continue;
      const group = groups.get(id) || { correct: 0 };
      if (isTruthy(cellAt(row, correctIndex))) group.correct += 1;
      groups.set(id, group);
    }
    if (!groups.size) return { level: 'warn', title: 'No complete questions found', detail: 'Every row is missing a question_id or option_text.' };
    const noCorrect = Array.from(groups.values()).filter(group => !group.correct).length;
    const problems = noCorrect ? [`${noCorrect} question${noCorrect === 1 ? '' : 's'} with no correct answer marked (is_correct)`] : [];
    return tabularResult(`Grouped ${kind}`, groups.size, 'Questions', problems);
  }

  const questionIndex = colIndex(headers, 'question', 'question title', 'question_title', 'question text', 'question_text', 'stem');
  const correctIndex = colIndex(headers, 'correct_answer', 'correct answer', 'answer', 'correct');
  const typeIndex = colIndex(headers, 'question_type', 'question type');
  const optionCols = optionIndices(headers);
  // Only choice-style types are expected to carry option columns / a plain
  // correct answer here — matching / ordering / keywords derive theirs elsewhere.
  const optionTypes = new Set(['', 'single_choice', 'single', 'multiple_choice', 'multiple', 'true_false']);
  const answerTypes = new Set(['', 'single_choice', 'single', 'multiple_choice', 'multiple', 'true_false', 'fill_gap', 'fill_blank']);
  let counted = 0;
  let noAnswer = 0;
  let noOptions = 0;
  for (const row of dataRows) {
    if (!cellAt(row, questionIndex)) continue;
    counted += 1;
    const type = cellAt(row, typeIndex).toLowerCase().replace(/[\s-]+/g, '_');
    if (optionTypes.has(type) && !optionCols.some(index => cellAt(row, index))) noOptions += 1;
    if (answerTypes.has(type) && !cellAt(row, correctIndex)) noAnswer += 1;
  }
  if (!counted) return { level: 'warn', title: 'No questions found', detail: 'Rows are present, but none have text in the question column.' };

  const problems: string[] = [];
  if (noAnswer) problems.push(`${noAnswer} row${noAnswer === 1 ? '' : 's'} with no correct_answer`);
  if (noOptions) problems.push(`${noOptions} row${noOptions === 1 ? '' : 's'} with no answer options`);
  return tabularResult(`Row-per-question ${kind}`, counted, 'Rows', problems);
}

function validateCsv(text: string): ValidationResult {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length);
  if (!lines.length) return { level: 'error', title: 'This CSV is empty', detail: 'Add a header row and at least one question.' };
  const headers = splitCsvLine(lines[0]).map(header => header.toLowerCase());
  const rows = lines.slice(1).map(line => splitCsvLine(line));
  return analyzeTabular('CSV', headers, rows);
}

async function validateExcel(file: File): Promise<ValidationResult> {
  const buffer = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch {
    return { level: 'error', title: "This doesn't open as a workbook", detail: 'The file could not be read as Excel. Re-save it as .xlsx and try again.' };
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { level: 'error', title: 'This workbook has no sheets', detail: 'Put your questions on the first sheet.' };

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: '' }) as unknown[][];
  if (!rows.length) return { level: 'error', title: 'This sheet is empty', detail: 'Add a header row and at least one question.' };
  const headers = (rows[0] || []).map(cell => String(cell ?? '').trim().toLowerCase());
  return analyzeTabular('Excel', headers, rows.slice(1));
}

function xmlResult(shapeLabel: string, shape: XmlShape, count: number, problems: string[]): ValidationResult {
  const stats = [{ label: 'Shape', value: shapeLabel }, { label: 'Questions', value: String(count) }];
  if (problems.length) {
    return {
      level: 'warn',
      shape,
      title: `${shapeLabel} format — ${problems.length} issue${problems.length === 1 ? '' : 's'} to check`,
      detail: `${problems.join('; ')}. You can still upload, but affected questions may not grade correctly.`,
      stats: [...stats, { label: 'Issues', value: String(problems.length) }],
    };
  }
  return { level: 'ok', shape, title: `${shapeLabel} format — ${count} question${count === 1 ? '' : 's'}`, detail: 'Structure and answers look complete.', stats };
}

export function validateXml(text: string): ValidationResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const message = (parseError.textContent || '').split('\n').map(line => line.trim()).filter(Boolean)[0];
    return { level: 'error', title: "This isn't valid XML", detail: message || 'The file could not be parsed. Check for unclosed or mismatched tags.' };
  }

  const all = Array.from(doc.getElementsByTagName('*'));
  const byTag = (tag: string) => all.filter(element => element.tagName.toLowerCase() === tag);
  const childValues = (element: Element, ...tags: string[]) =>
    Array.from(element.getElementsByTagName('*'))
      .filter(child => tags.includes(child.tagName.toLowerCase()))
      .map(child => (child.textContent || '').trim());

  const records = byTag('record');
  const questions = byTag('question');

  if (records.length) {
    const withTitle = records.filter(record => childValues(record, 'question_title').some(Boolean));
    if (!withTitle.length) {
      return { level: 'error', title: 'Record format found, but no <Question_Title>', detail: 'Each <record> needs a <Question_Title>. Check the tag spelling and casing.' };
    }
    let noAnswer = 0;
    let noOptions = 0;
    for (const record of records) {
      const options = childValues(record, 'option_1', 'option_2', 'option_3', 'option_4', 'option_5').filter(Boolean);
      const answer = childValues(record, 'answer').find(Boolean);
      if (!options.length) noOptions += 1;
      if (!answer) noAnswer += 1;
    }
    const problems: string[] = [];
    if (noAnswer) problems.push(`${noAnswer} question${noAnswer === 1 ? '' : 's'} with no <Answer>`);
    if (noOptions) problems.push(`${noOptions} question${noOptions === 1 ? '' : 's'} with no options`);
    return xmlResult('Record', 'record', records.length, problems);
  }

  if (questions.length) {
    const withText = questions.filter(
      question => childValues(question, 'text', 'stem', 'question_text').some(Boolean) || (question.getAttribute('text') || '').trim(),
    );
    if (!withText.length) {
      return { level: 'error', title: 'Question format found, but no <text>', detail: 'Each <question> needs a <text> (or <stem>) element.' };
    }
    const elements = (question: Element, ...tags: string[]) => {
      const wanted = new Set(tags.map(tag => tag.toLowerCase()));
      return Array.from(question.getElementsByTagName('*'))
        .filter(child => wanted.has(child.tagName.toLowerCase()));
    };
    const normaliseType = (value: string) => {
      const type = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
      const aliases: Record<string, string> = {
        single: 'single_choice',
        multiple: 'multiple_choice',
        multi_choice: 'multiple_choice',
        truefalse: 'true_false',
        fill_blank: 'fill_gap',
        fill_in_the_gap: 'fill_gap',
        image: 'image_matching',
        imagematching: 'image_matching',
        match: 'matching',
        keyword: 'keywords',
        order: 'ordering',
      };
      return aliases[type] || type || 'single_choice';
    };
    const isCorrect = (option: Element) => {
      if (['true', '1', 'yes'].includes((option.getAttribute('correct') || '').trim().toLowerCase())) return true;
      return Number(option.getAttribute('fraction') || 0) > 0;
    };
    const choiceTypes = new Set(['single_choice', 'multiple_choice', 'true_false']);
    const supportedTypes = new Set([...choiceTypes, 'matching', 'image_matching', 'keywords', 'fill_gap', 'ordering']);
    let noAnswers = 0;
    let noCorrect = 0;
    let unsupported = 0;
    for (const question of questions) {
      const type = normaliseType(question.getAttribute('type') || '');
      if (!supportedTypes.has(type)) {
        unsupported += 1;
        continue;
      }
      if (choiceTypes.has(type)) {
        const options = elements(question, 'option').length
          ? elements(question, 'option')
          : elements(question, 'answer');
        if (!options.length) noAnswers += 1;
        else if (!options.some(isCorrect)) noCorrect += 1;
      } else if (type === 'matching') {
        const pairs = elements(question, 'pair');
        if (!pairs.length || pairs.some(pair => !childValues(pair, 'left').some(Boolean) || !childValues(pair, 'right').some(Boolean))) noAnswers += 1;
      } else if (type === 'image_matching') {
        const pairs = elements(question, 'pair');
        if (!pairs.length || pairs.some(pair => {
          const hasPrompt = childValues(pair, 'image', 'image_url', 'imageurl', 'display', 'label', 'left').some(Boolean);
          return !hasPrompt || !childValues(pair, 'right').some(Boolean);
        })) noAnswers += 1;
      } else if (type === 'keywords') {
        if (!elements(question, 'keyword').some(keyword => (keyword.textContent || '').trim())) noAnswers += 1;
      } else if (type === 'fill_gap') {
        if (!elements(question, 'answer', 'option').some(answer => (answer.textContent || '').trim())) noAnswers += 1;
      } else if (type === 'ordering') {
        if (!elements(question, 'item').some(item => (item.textContent || '').trim())) noAnswers += 1;
      }
    }
    const problems: string[] = [];
    if (unsupported) problems.push(`${unsupported} question${unsupported === 1 ? '' : 's'} with an unsupported type`);
    if (noAnswers) problems.push(`${noAnswers} question${noAnswers === 1 ? '' : 's'} with missing or incomplete answer data`);
    if (noCorrect) problems.push(`${noCorrect} question${noCorrect === 1 ? '' : 's'} with no correct="true" option`);
    return xmlResult('Question', 'question', questions.length, problems);
  }

  return {
    level: 'error',
    title: 'No questions found in this XML',
    detail: 'Expected <record> blocks or <question> blocks — this file has neither.',
  };
}

async function readSignature(file: File) {
  const buffer = await file.slice(0, 4).arrayBuffer();
  return new Uint8Array(buffer);
}

async function runValidation(format: FormatKey, file: File): Promise<ValidationResult> {
  const meta = FORMAT_BY_KEY[format];
  const ext = extensionOf(file.name);

  if (!meta.exts.includes(ext)) {
    return {
      level: 'error',
      title: `That's ${ext ? `a ${ext}` : 'an unrecognised'} file`,
      detail: `The ${meta.label} format expects ${meta.extLabel}. Pick the matching format above, or choose a ${meta.extLabel} file.`,
    };
  }

  if (file.size === 0) {
    return { level: 'error', title: 'This file is empty', detail: 'There is nothing to read. Export the file again and re-upload.' };
  }

  if (format === 'csv' || format === 'xml') {
    if (file.size > MAX_TEXT_PARSE_BYTES) {
      return { level: 'warn', title: 'File is large', detail: 'Skipped the on-device structure check. It will be validated when you upload.' };
    }
    const text = await file.text();
    return format === 'csv' ? validateCsv(text) : validateXml(text);
  }

  // Excel + SCORM are zip containers — confirm the zip signature first.
  const signature = await readSignature(file);
  const isZip = signature[0] === 0x50 && signature[1] === 0x4b;
  if (!isZip) {
    return {
      level: 'error',
      title: `This doesn't look like a ${meta.label} file`,
      detail: `${meta.label} files are ${meta.extLabel} — a zip container. This file's contents don't match its extension.`,
    };
  }

  if (format === 'excel') {
    if (file.size > MAX_TEXT_PARSE_BYTES) {
      return { level: 'warn', title: 'File is large', detail: 'Skipped the on-device structure check. It will be validated when you upload.' };
    }
    try {
      return await validateExcel(file);
    } catch {
      return { level: 'warn', title: 'Workbook looks intact', detail: "Couldn't read the columns on-device — they'll be checked when you upload." };
    }
  }

  // SCORM — we can't open the package in the browser, so verify on upload.
  return { level: 'ok', title: 'Package looks intact', detail: 'The zip is readable. imsmanifest.xml and the questions inside are checked when you upload.' };
}

/* ------------------------------------------------------------------ *
 * Syntax highlighting for the code specimens
 * ------------------------------------------------------------------ */

function highlightXml(line: string): ReactNode[] {
  if (line.trimStart().startsWith('<?')) {
    return [<span key="decl" className="text-slate-500">{line}</span>];
  }
  const nodes: ReactNode[] = [];
  let rest = line;
  let key = 0;
  const add = (text: string, className: string) => {
    if (text) nodes.push(<span key={key++} className={className}>{text}</span>);
  };
  while (rest.length) {
    let match = rest.match(/^<\/?[A-Za-z_][\w:.\-]*/);
    if (match) { add(match[0], 'text-sky-300'); rest = rest.slice(match[0].length); continue; }
    match = rest.match(/^\/?>/);
    if (match) { add(match[0], 'text-slate-500'); rest = rest.slice(match[0].length); continue; }
    match = rest.match(/^\s+[A-Za-z_][\w:.\-]*=/);
    if (match) {
      const whitespace = match[0].match(/^\s+/)![0];
      add(whitespace, '');
      add(match[0].slice(whitespace.length, -1), 'text-violet-300');
      add('=', 'text-slate-500');
      rest = rest.slice(match[0].length);
      continue;
    }
    match = rest.match(/^"[^"]*"/);
    if (match) { add(match[0], 'text-emerald-300'); rest = rest.slice(match[0].length); continue; }
    match = rest.match(/^\s+/);
    if (match) { add(match[0], ''); rest = rest.slice(match[0].length); continue; }
    match = rest.match(/^[^<]+/);
    if (match) { add(match[0], 'text-slate-100'); rest = rest.slice(match[0].length); continue; }
    add(rest[0], 'text-slate-100');
    rest = rest.slice(1);
  }
  return nodes;
}

function highlightCsvValues(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /"[^"]*"|,|[^,"]+/g;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(line))) {
    const token = match[0];
    if (token === ',') nodes.push(<span key={key++} className="text-slate-600">,</span>);
    else if (token.startsWith('"')) nodes.push(<span key={key++} className="text-emerald-300">{token}</span>);
    else nodes.push(<span key={key++} className="text-slate-200">{token}</span>);
  }
  return nodes;
}

/* ------------------------------------------------------------------ *
 * Pin context + annotated primitives
 * ------------------------------------------------------------------ */

const PinContext = createContext<{ hover: number | null; setHover: (n: number | null) => void; accent: string }>({
  hover: null,
  setHover: () => {},
  accent: '#000',
});

function PinChip({ n, floating }: { n: number; floating?: boolean }) {
  const { hover, accent } = useContext(PinContext);
  const active = hover === n;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold text-white transition-transform ${
        floating ? 'h-4 w-4 text-[10px]' : 'h-3.5 w-3.5 text-[9px] align-super ml-0.5'
      }`}
      style={{ backgroundColor: accent, transform: active ? 'scale(1.25)' : 'none' }}
    >
      {n}
    </span>
  );
}

/** Inline annotated token — used inside the CSV / Excel specimens. */
function Marked({ n, children }: { n: number; children: ReactNode }) {
  const { hover, setHover, accent } = useContext(PinContext);
  const active = hover === n;
  return (
    <span
      onMouseEnter={() => setHover(n)}
      onMouseLeave={() => setHover(null)}
      className="relative inline cursor-help rounded-[3px] px-0.5 transition-colors"
      style={active ? { backgroundColor: `${accent}26`, boxShadow: `inset 0 0 0 1px ${accent}` } : undefined}
    >
      {children}
      <PinChip n={n} />
    </span>
  );
}

/** Line-level annotation — used inside the XML / SCORM specimens. */
function PinLine({ pin, children }: { pin?: number; children: ReactNode }) {
  const { hover, setHover, accent } = useContext(PinContext);
  const active = pin != null && hover === pin;
  return (
    <div
      className="flex items-start"
      onMouseEnter={() => pin != null && setHover(pin)}
      onMouseLeave={() => pin != null && setHover(null)}
    >
      <span className="w-6 shrink-0 select-none pr-2 text-right">
        {pin != null && <PinChip n={pin} floating />}
      </span>
      <span
        className="-mx-1 flex-1 rounded px-1 transition-colors"
        style={active ? { backgroundColor: `${accent}1f` } : undefined}
      >
        {children}
      </span>
    </div>
  );
}

function RailItem({ pin }: { pin: Pin }) {
  const { hover, setHover, accent } = useContext(PinContext);
  const active = hover === pin.n;
  return (
    <li
      onMouseEnter={() => setHover(pin.n)}
      onMouseLeave={() => setHover(null)}
      className={`flex gap-3 rounded-lg p-2 transition-colors ${active ? 'bg-background-100' : ''}`}
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        {pin.n}
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[12px] font-semibold text-foreground-900">{pin.title}</p>
        <p className={`mt-0.5 text-xs leading-snug ${pin.warn ? 'text-amber-600' : 'text-foreground-500'}`}>
          {pin.warn && <AppIcon className="ri-alert-line mr-1" />}
          {pin.detail}
        </p>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Specimens (the signature element)
 * ------------------------------------------------------------------ */

function CodeSurface({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-[#0b1220] p-4 font-mono text-[12.5px] leading-6 text-slate-200 ring-1 ring-white/10">
      <code>{children}</code>
    </pre>
  );
}

interface CsvCell {
  name: string;
  pin?: number;
}

const CSV_CELLS: CsvCell[] = [
  { name: 'question_type', pin: 1 },
  { name: 'question', pin: 2 },
  { name: 'option_a', pin: 3 },
  { name: 'option_b' },
  { name: 'option_c' },
  { name: 'option_d' },
  { name: 'option_e' },
  { name: 'correct_answer', pin: 4 },
  { name: 'feedback', pin: 6 },
  { name: 'quiz_title', pin: 5 },
  { name: 'programme', pin: 5 },
  { name: 'module', pin: 5 },
];

const CSV_DATA_ROW =
  'single_choice,"What is paid social?","Organic post","Sponsored content","Employee post","Newsletter","","B","Paid social uses ad spend.","Social Media Quiz","Marketing Exec L4","Organic vs Paid"';

function CsvSpecimen() {
  return (
    <CodeSurface>
      <div className="whitespace-nowrap">
        {CSV_CELLS.map((cell, index) => (
          <span key={cell.name}>
            {index > 0 && <span className="text-slate-600">,</span>}
            {cell.pin ? (
              <Marked n={cell.pin}>
                <span className="text-sky-300">{cell.name}</span>
              </Marked>
            ) : (
              <span className="text-sky-300/60">{cell.name}</span>
            )}
          </span>
        ))}
      </div>
      <div className="mt-1 whitespace-nowrap">{highlightCsvValues(CSV_DATA_ROW)}</div>
    </CodeSurface>
  );
}

const EXCEL_COLUMNS: { letter: string; name: string; pin?: number }[] = [
  { letter: 'A', name: 'question_type', pin: 1 },
  { letter: 'B', name: 'question', pin: 2 },
  { letter: 'C', name: 'option_a', pin: 3 },
  { letter: 'D', name: 'option_b' },
  { letter: 'E', name: 'option_c' },
  { letter: 'F', name: 'correct_answer', pin: 4 },
  { letter: 'G', name: 'feedback', pin: 6 },
  { letter: 'H', name: 'quiz_title', pin: 5 },
  { letter: 'I', name: 'programme', pin: 5 },
  { letter: 'J', name: 'module', pin: 5 },
];

const EXCEL_DATA_ROW = ['single_choice', 'What is paid social?', 'Organic post', 'Sponsored content', 'Employee post', 'B', 'Paid social…', 'Social Media Quiz', 'Marketing Exec L4', 'Organic vs Paid'];

function ExcelSpecimen() {
  return (
    <div className="overflow-x-auto rounded-xl bg-[#0b1220] p-3 ring-1 ring-white/10">
      <table className="w-full border-collapse text-left font-mono text-[11px] text-slate-200">
        <thead>
          <tr>
            <th className="w-8 border border-white/10 bg-white/5 px-2 py-1 text-slate-500" />
            {EXCEL_COLUMNS.map(column => (
              <th key={column.letter} className="border border-white/10 bg-white/5 px-2 py-1 text-center font-normal text-slate-500">
                {column.letter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-white/10 bg-white/5 px-2 py-1 text-center text-slate-500">1</td>
            {EXCEL_COLUMNS.map(column => (
              <td key={column.name} className="whitespace-nowrap border border-white/10 px-2 py-1 font-semibold text-sky-300">
                {column.pin ? <Marked n={column.pin}>{column.name}</Marked> : column.name}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-white/10 bg-white/5 px-2 py-1 text-center text-slate-500">2</td>
            {EXCEL_DATA_ROW.map((value, index) => (
              <td key={index} className="whitespace-nowrap border border-white/10 px-2 py-1 text-slate-300">
                {value}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const XML_RECORD_LINES: { code: string; pin?: number }[] = [
  { code: '<records>' },
  { code: '  <record>', pin: 1 },
  { code: '    <Quiz_Title>Social Media Quiz</Quiz_Title>' },
  { code: '    <Course_Name>Marketing Exec L4</Course_Name>', pin: 6 },
  { code: '    <Section_Name>Organic vs Paid</Section_Name>', pin: 6 },
  { code: '    <Question_Type>single_choice</Question_Type>' },
  { code: '    <Question_Title>What is paid social?</Question_Title>', pin: 2 },
  { code: '    <Option_1>Organic post</Option_1>', pin: 3 },
  { code: '    <Option_2>Sponsored content</Option_2>' },
  { code: '    <Option_3>Employee post</Option_3>' },
  { code: '    <Option_4>Newsletter</Option_4>' },
  { code: '    <Answer>2</Answer>', pin: 4 },
  { code: '    <Question_Explanation_1>Paid social uses advertising spend.</Question_Explanation_1>', pin: 5 },
  { code: '  </record>' },
  { code: '</records>' },
];

const XML_QUESTION_LINES: { code: string; pin?: number }[] = [
  { code: '<?xml version="1.0" encoding="UTF-8"?>' },
  { code: '<quiz>' },
  { code: '  <metadata>' },
  { code: '    <title>All Question Types Quiz</title>' },
  { code: '    <module />', pin: 6 },
  { code: '    <programme />', pin: 6 },
  { code: '  </metadata>' },
  { code: '  <questions>' },
  { code: '    <question type="single_choice">', pin: 1 },
  { code: '      <text>Which protocol secures web traffic?</text>', pin: 2 },
  { code: '      <option correct="false">HTTP</option>' },
  { code: '      <option correct="true">HTTPS</option>', pin: 3 },
  { code: '      <feedback>HTTPS encrypts browser traffic.</feedback>', pin: 5 },
  { code: '    </question>' },
  { code: '    <question type="matching">', pin: 1 },
  { code: '      <text>Match each status code.</text>', pin: 2 },
  { code: '      <pairs>', pin: 4 },
  { code: '        <pair><left>200</left><right>OK</right></pair>' },
  { code: '        <pair><left>404</left><right>Not Found</right></pair>' },
  { code: '      </pairs>' },
  { code: '    </question>' },
  { code: '    <question type="fill_gap">', pin: 1 },
  { code: '      <text>HTTPS keeps traffic _____.</text>', pin: 2 },
  { code: '      <acceptedAnswers>', pin: 4 },
  { code: '        <answer>secure</answer>' },
  { code: '        <answer>encrypted</answer>' },
  { code: '      </acceptedAnswers>' },
  { code: '    </question>' },
  { code: '    <!-- Download Template for examples of all 8 types. -->' },
  { code: '  </questions>' },
  { code: '</quiz>' },
];

function XmlSpecimen({ shape }: { shape: XmlShape }) {
  const lines = shape === 'record' ? XML_RECORD_LINES : XML_QUESTION_LINES;
  return (
    <CodeSurface>
      {lines.map((line, index) => (
        <PinLine key={index} pin={line.pin}>
          {highlightXml(line.code)}
        </PinLine>
      ))}
    </CodeSurface>
  );
}

const SCORM_NODES: { depth: number; icon: string; label: string; pin?: number; note?: string; required?: boolean }[] = [
  { depth: 0, icon: 'ri-folder-zip-fill', label: 'social-media-quiz.zip' },
  { depth: 1, icon: 'ri-file-code-line', label: 'imsmanifest.xml', pin: 1, required: true },
  { depth: 1, icon: 'ri-folder-3-line', label: 'content/' },
  { depth: 2, icon: 'ri-file-list-2-line', label: 'quiz.xml', pin: 2, note: 'Record or Question XML' },
  { depth: 2, icon: 'ri-braces-line', label: 'quiz.json', pin: 2, note: 'or course-data JSON' },
  { depth: 2, icon: 'ri-file-text-line', label: 'quiz.txt', pin: 2, note: 'or plain-text Q&A' },
  { depth: 2, icon: 'ri-html5-line', label: 'index.html' },
  { depth: 1, icon: 'ri-folder-image-line', label: 'assets/', note: 'images, css…' },
];

function ScormSpecimen() {
  const { hover, setHover, accent } = useContext(PinContext);
  return (
    <div className="overflow-x-auto rounded-xl bg-[#0b1220] p-4 font-mono text-[12.5px] leading-7 text-slate-200 ring-1 ring-white/10">
      {SCORM_NODES.map((node, index) => {
        const active = node.pin != null && hover === node.pin;
        return (
          <div
            key={index}
            className="-mx-1 flex items-center rounded px-1 transition-colors"
            onMouseEnter={() => node.pin != null && setHover(node.pin)}
            onMouseLeave={() => node.pin != null && setHover(null)}
            style={active ? { backgroundColor: `${accent}1f` } : undefined}
          >
            <span style={{ width: node.depth * 18 }} className="shrink-0" />
            {node.depth > 0 && <span className="mr-1 text-slate-600">{index === SCORM_NODES.length - 1 ? '└' : '├'}</span>}
            <AppIcon className={`${node.icon} mr-1.5`} style={{ color: node.depth === 0 ? accent : undefined }} />
            <span className={node.required ? 'text-slate-100' : 'text-slate-300'}>{node.label}</span>
            {node.required && (
              <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: accent }}>
                required
              </span>
            )}
            {node.note && <span className="ml-2 text-[11px] text-slate-500">← {node.note}</span>}
            {node.pin != null && <span className="ml-2"><PinChip n={node.pin} floating /></span>}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 1 — format cards
 * ------------------------------------------------------------------ */

function FormatCard({ meta, selected, onSelect }: { meta: FormatMeta; selected: boolean; onSelect: () => void }) {
  const accent = ACCENT[meta.key];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative flex flex-col rounded-2xl border p-4 text-left transition-smooth ${
        selected ? 'bg-background-50 shadow-lg' : 'border-background-200 bg-background-50 hover:border-foreground-300 hover:shadow-md'
      }`}
      style={selected ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` } : undefined}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-xl text-xl text-white"
          style={{ backgroundColor: accent }}
        >
          <AppIcon className={meta.icon} />
        </span>
        <div>
          <p className="font-heading text-base font-bold text-foreground-900">{meta.label}</p>
          <span className="font-mono text-[11px] text-foreground-500">{meta.extLabel}</span>
        </div>
        {selected && (
          <span className="ml-auto text-xl" style={{ color: accent }}>
            <AppIcon className="ri-checkbox-circle-fill" />
          </span>
        )}
      </div>
      <p className="mt-3 text-[13px] leading-snug text-foreground-600">{meta.tagline}</p>
      <div className="mt-3 overflow-hidden rounded-lg bg-[#0b1220] px-3 py-2 font-mono text-[10.5px] leading-4 text-slate-400">
        {meta.peek.map((line, index) => (
          <div key={index} className="truncate">{line}</div>
        ))}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Main component
 * ------------------------------------------------------------------ */

export function GuidedQuizUpload({ open, onClose, onUploaded, scope }: GuidedQuizUploadProps) {
  const { success, warning, error: toastError } = useToast();

  const [step, setStep] = useState(1);
  const [format, setFormat] = useState<FormatKey | null>(null);
  const [xmlShape, setXmlShape] = useState<XmlShape>('record');
  const [hoverPin, setHoverPin] = useState<number | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('draft');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [saving, setSaving] = useState(false);

  const dropInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  const accent = format ? ACCENT[format] : '#6366f1';

  const pins = useMemo<Pin[]>(() => {
    if (format === 'csv' || format === 'excel') return CSV_PINS;
    if (format === 'xml') return xmlShape === 'record' ? XML_RECORD_PINS : XML_QUESTION_PINS;
    if (format === 'scorm') return SCORM_PINS;
    return [];
  }, [format, xmlShape]);

  const rulesKey = format === 'xml' ? `xml-${xmlShape}` : format;
  const rules = (rulesKey && RULES[rulesKey]) || [];
  const showAnswerChips = format === 'csv' || format === 'excel' || (format === 'xml' && xmlShape === 'record');

  if (!open) return null;

  const selectFile = async (candidate: File) => {
    if (!format) return;
    setFile(candidate);
    setValidating(true);
    setValidation(null);
    try {
      const result = await runValidation(format, candidate);
      setValidation(result);
      if (result.shape) setXmlShape(result.shape);
      if (!title.trim()) {
        setTitle(candidate.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim());
      }
    } catch {
      setValidation({ level: 'error', title: "Couldn't read that file", detail: 'Try exporting it again, or choose a different file.' });
    } finally {
      setValidating(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) void selectFile(dropped);
  };

  const clearFile = () => {
    setFile(null);
    setValidation(null);
    if (dropInputRef.current) dropInputRef.current.value = '';
  };

  const downloadTemplate = () => {
    if (format === 'csv') {
      downloadText('quiz-template.csv', CSV_TEMPLATE, 'text/csv;charset=utf-8');
    } else if (format === 'excel') {
      downloadExcelTemplate();
    } else if (format === 'xml') {
      const isRecord = xmlShape === 'record';
      downloadText(isRecord ? 'quiz-template-record.xml' : 'quiz-template-question.xml', isRecord ? XML_RECORD_TEMPLATE : XML_QUESTION_TEMPLATE, 'application/xml;charset=utf-8');
    }
  };

  const save = async () => {
    if (!file || !format || saving) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('title', title.trim() || file.name.replace(/\.[^.]+$/, ''));
      body.append('programme', scope.programmeName);
      body.append('module', scope.moduleName);
      body.append('programmeId', scope.programmeId);
      body.append('version', 'v1.0');
      body.append('status', status);
      body.append('duration', String(durationMinutes));
      body.append('timeUnit', 'minutes');
      body.append('author', 'Curriculum Team');
      body.append('assessmentType', 'quiz');

      const response = await fetch('/quiz_api/quizzes/', { method: 'POST', body });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Upload failed. Check the file and try again.');

      onUploaded(data);
      if (data?.schemaValid === false) {
        warning('Uploaded — but check the structure', data.validationMessage || 'The file saved, but the parser flagged a structure issue.');
      } else {
        success('Quiz uploaded & linked', `${data?.questions ?? 0} question${data?.questions === 1 ? '' : 's'} imported and attached to this week.`);
      }
      onClose();
    } catch (err) {
      toastError('Upload failed', err instanceof Error ? err.message : 'Something went wrong while uploading.');
    } finally {
      setSaving(false);
    }
  };

  const canLeaveStep2 = validation != null && validation.level !== 'error' && !validating;
  const selectedMeta = format ? FORMAT_BY_KEY[format] : null;

  const steps = [
    { n: 1, label: 'Format' },
    { n: 2, label: 'Structure' },
    { n: 3, label: 'Details' },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground-950/50 backdrop-blur-sm p-4 sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <style>{`
        @keyframes gqu-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .gqu-anim { animation: gqu-rise .28s ease both; }
        @media (prefers-reduced-motion: reduce) { .gqu-anim { animation: none; } }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Guided quiz upload"
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl ring-1 ring-background-200"
        onClick={event => event.stopPropagation()}
      >
        {/* Header + step bar */}
        <div className="flex items-center justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white transition-colors"
              style={{ backgroundColor: accent }}
            >
              <AppIcon className="ri-upload-cloud-2-line" />
            </span>
            <div>
              <h3 className="font-heading text-base font-bold text-foreground-900">Upload a quiz</h3>
              <p className="text-xs text-foreground-500">Pick a format, match the structure, then upload — it links to this week automatically.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-100 text-foreground-500 hover:bg-background-200"
          >
            <AppIcon className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-3">
          {steps.map((item, index) => {
            const state = step === item.n ? 'active' : step > item.n ? 'done' : 'todo';
            return (
              <div key={item.n} className="flex flex-1 items-center gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      state === 'todo' ? 'bg-background-200 text-foreground-500' : 'text-white'
                    }`}
                    style={state !== 'todo' ? { backgroundColor: accent } : undefined}
                  >
                    {state === 'done' ? <AppIcon className="ri-check-line" /> : item.n}
                  </span>
                  <span className={`text-xs font-semibold ${state === 'active' ? 'text-foreground-900' : 'text-foreground-500'}`}>
                    {item.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <span className="h-px flex-1 rounded bg-background-200" style={step > item.n ? { backgroundColor: accent } : undefined} />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {/* STEP 1 — format */}
          {step === 1 && (
            <div key="step1" className="gqu-anim">
              <p className="mb-3 text-sm text-foreground-600">Which file are you uploading? Each format comes with its own structure guide.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {FORMATS.map(meta => (
                  <FormatCard key={meta.key} meta={meta} selected={format === meta.key} onSelect={() => setFormat(meta.key)} />
                ))}
              </div>
            </div>
          )}

          {/* STEP 2 — structure + upload */}
          {step === 2 && selectedMeta && (
            <PinContext.Provider value={{ hover: hoverPin, setHover: setHoverPin, accent }}>
              <div key="step2" className="gqu-anim grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
                <div className="min-w-0 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>
                        {selectedMeta.label} structure
                      </span>
                      {format === 'xml' && (
                        <div className="flex rounded-lg bg-background-100 p-0.5">
                          {(['record', 'question'] as XmlShape[]).map(shape => (
                            <button
                              key={shape}
                              type="button"
                              onClick={() => setXmlShape(shape)}
                              className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                                xmlShape === shape ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'
                              }`}
                            >
                              {shape}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {(format === 'csv' || format === 'excel' || format === 'xml') && (
                      <button
                        type="button"
                        onClick={downloadTemplate}
                        className="inline-flex items-center gap-1 rounded-lg border border-background-200 bg-background-50 px-2.5 py-1.5 text-xs font-semibold text-foreground-700 hover:bg-background-100"
                      >
                        <AppIcon className="ri-download-2-line" /> Template
                      </button>
                    )}
                  </div>

                  {format === 'csv' && <CsvSpecimen />}
                  {format === 'excel' && <ExcelSpecimen />}
                  {format === 'xml' && <XmlSpecimen shape={xmlShape} />}
                  {format === 'scorm' && <ScormSpecimen />}

                  {showAnswerChips && (
                    <div className="rounded-xl border border-background-200 bg-background-50 p-3">
                      <p className="mb-2 text-xs font-semibold text-foreground-700">Correct-answer values you can use</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ANSWER_CHIPS.map(chip => (
                          <span key={chip} className="rounded-md bg-background-100 px-2 py-1 font-mono text-[11px] text-foreground-700">
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-4">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-500">What each part means</p>
                    <ul className="space-y-0.5">
                      {pins.map(pin => (
                        <RailItem key={pin.n} pin={pin} />
                      ))}
                    </ul>
                  </div>

                  {rules.length > 0 && (
                    <div className="rounded-xl border border-background-200 bg-background-50 p-3">
                      <p className="mb-2 text-xs font-semibold text-foreground-700">Before you upload</p>
                      <ul className="space-y-1.5">
                        {rules.map(rule => (
                          <li key={rule} className="flex gap-2 text-xs text-foreground-600">
                            <AppIcon className="ri-checkbox-circle-line mt-0.5 shrink-0" style={{ color: accent }} />
                            <span>{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Drop zone spans both columns */}
                <div className="lg:col-span-2">
                  <input
                    ref={dropInputRef}
                    type="file"
                    accept={selectedMeta.accept}
                    className="hidden"
                    onChange={event => {
                      const chosen = event.target.files?.[0];
                      if (chosen) void selectFile(chosen);
                    }}
                  />
                  {!file ? (
                    <div
                      onDragOver={event => {
                        event.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={onDrop}
                      onClick={() => dropInputRef.current?.click()}
                      className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors"
                      style={{
                        borderColor: dragActive ? accent : 'rgb(0 0 0 / 0.15)',
                        backgroundColor: dragActive ? `${accent}12` : undefined,
                      }}
                    >
                      <AppIcon className="ri-upload-cloud-2-line mb-2 text-3xl" style={{ color: accent }} />
                      <p className="text-sm font-semibold text-foreground-800">
                        Drop your {selectedMeta.extLabel} file here, or <span style={{ color: accent }}>browse</span>
                      </p>
                      <p className="mt-1 text-xs text-foreground-500">We check it matches this structure before uploading.</p>
                    </div>
                  ) : (
                    <ValidationPanel
                      file={file}
                      validating={validating}
                      validation={validation}
                      accent={accent}
                      onReplace={clearFile}
                    />
                  )}
                </div>
              </div>
            </PinContext.Provider>
          )}

          {/* STEP 3 — details */}
          {step === 3 && (
            <div key="step3" className="gqu-anim space-y-4">
              {file && validation && (
                <div className="flex items-center gap-3 rounded-xl border border-background-200 bg-background-50 p-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ backgroundColor: accent }}>
                    <AppIcon className={selectedMeta?.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground-900">{file.name}</p>
                    <p className="text-xs text-foreground-500">
                      {validation.stats?.map(stat => `${stat.label}: ${stat.value}`).join(' · ') || validation.title}
                    </p>
                  </div>
                  <button type="button" onClick={() => setStep(2)} className="text-xs font-semibold text-foreground-500 hover:text-foreground-800">
                    Change
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-foreground-700">Quiz title</span>
                  <input
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    placeholder="Quiz title"
                    className="h-10 w-full rounded-lg border border-background-200 px-3 text-sm outline-none focus:border-primary-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-foreground-700">Status</span>
                  <ThemedSelect value={status} options={STATUS_OPTIONS} onChange={setStatus} />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-foreground-700">Quiz duration (minutes)</span>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    step="1"
                    value={durationMinutes}
                    onChange={event => setDurationMinutes(Math.min(1440, Math.max(1, Number(event.target.value))))}
                    className="h-10 w-full rounded-lg border border-background-200 px-3 text-sm outline-none focus:border-primary-400"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-background-200 bg-background-100/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-500">Will be added to</p>
                <p className="mt-1 text-sm text-foreground-800">
                  <AppIcon className="ri-price-tag-3-line mr-1" style={{ color: accent }} />
                  <strong>{scope.programmeName || 'This programme'}</strong>
                  {scope.moduleName ? <> · {scope.moduleName}</> : ''}
                </p>
                <p className="mt-1 text-[11px] text-foreground-400">
                  The quiz is created in the Quiz Workspace and linked to this week. You can edit its questions afterwards from the linked-quiz card.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between gap-3 border-t border-background-200 px-5 py-4">
          <button
            type="button"
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-50"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step === 1 && (
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!format}
              className="rounded-lg bg-primary-500 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!canLeaveStep2}
              className="rounded-lg bg-primary-500 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue to details
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !file}
              className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-primary-500 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:cursor-wait disabled:opacity-70"
            >
              {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
              {saving ? 'Uploading…' : 'Upload & link quiz'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Validation result panel
 * ------------------------------------------------------------------ */

function ValidationPanel({
  file,
  validating,
  validation,
  accent,
  onReplace,
}: {
  file: File;
  validating: boolean;
  validation: ValidationResult | null;
  accent: string;
  onReplace: () => void;
}) {
  const tone =
    validation?.level === 'error'
      ? { bg: 'bg-red-50', ring: 'ring-red-200', text: 'text-red-700', icon: 'ri-close-circle-fill' }
      : validation?.level === 'warn'
        ? { bg: 'bg-amber-50', ring: 'ring-amber-200', text: 'text-amber-700', icon: 'ri-error-warning-fill' }
        : { bg: 'bg-emerald-50', ring: 'ring-emerald-200', text: 'text-emerald-700', icon: 'ri-checkbox-circle-fill' };

  return (
    <div className={`rounded-2xl p-4 ring-1 ${validating ? 'bg-background-100 ring-background-200' : `${tone.bg} ${tone.ring}`}`}>
      <div className="flex items-start gap-3">
        {validating ? (
          <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-foreground-300 border-t-foreground-600" />
        ) : (
          <AppIcon className={`${tone.icon} mt-0.5 text-xl ${tone.text}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground-900" title={file.name}>{file.name}</p>
            <span className="shrink-0 text-xs text-foreground-500">{(file.size / 1024).toFixed(0)} KB</span>
          </div>
          {validating ? (
            <p className="mt-0.5 text-xs text-foreground-500">Checking the structure…</p>
          ) : validation ? (
            <>
              <p className={`mt-0.5 text-sm font-semibold ${tone.text}`}>{validation.title}</p>
              {validation.detail && <p className="mt-0.5 text-xs leading-snug text-foreground-600">{validation.detail}</p>}
              {validation.stats && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {validation.stats.map(stat => (
                    <span key={stat.label} className="rounded-md bg-background-50 px-2 py-1 text-[11px] font-medium text-foreground-700 ring-1 ring-background-200">
                      {stat.label}: <span className="font-bold" style={{ color: accent }}>{stat.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onReplace}
          className="shrink-0 rounded-lg bg-background-50 px-3 py-1.5 text-xs font-semibold text-foreground-700 ring-1 ring-background-200 hover:bg-background-100"
        >
          Replace
        </button>
      </div>
    </div>
  );
}
