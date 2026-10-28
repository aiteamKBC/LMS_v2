

export type XmlShape = 'record' | 'question';

export type ValidationLevel = 'ok' | 'warn' | 'error';


export interface ValidationResult {
  level: ValidationLevel;
  title: string;
  detail?: string;
  stats?: { label: string; value: string }[];
  shape?: XmlShape;
}


export function xmlResult(shapeLabel: string, shape: XmlShape, count: number, problems: string[]): ValidationResult {
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
