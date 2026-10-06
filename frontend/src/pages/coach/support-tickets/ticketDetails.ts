// Presentation-only reading of the ticket `details` text.
//
// The Inclusion app writes survey tickets in a fixed shape: an intro line,
// "Key: value" facts, then "Triggered Questions:" followed by bullets such as
// "• I feel low or down. (Score: 7) [medium]". This pulls those pieces apart so
// the page can lay them out; anything it does not recognise is kept, in order,
// as plain text. Free-text tickets (no facts, no questions) return null and
// are shown exactly as written.

export interface TicketFact {
  label: string;
  value: string;
}

export interface TriggeredQuestion {
  text: string;
  score: string | null;
  severity: string | null;
}

export interface ParsedTicketDetails {
  intro: string[];
  facts: TicketFact[];
  questions: TriggeredQuestion[];
  other: string[];
}

const QUESTIONS_HEADING = /^triggered questions:\s*$/i;
const FACT_LINE = /^([A-Za-z][A-Za-z /&-]{1,30}):\s*(\S.*)$/;
const BULLET_LINE = /^\s*[•\-*]\s*(.+)$/;
const SCORE = /\s*\(Score:\s*([\d.]+)\)/i;
const SEVERITY = /\s*\[([A-Za-z]+)\]\s*$/;

function parseQuestion(line: string): TriggeredQuestion {
  let text = line;
  const severity = text.match(SEVERITY);
  if (severity) text = text.slice(0, severity.index);
  const score = text.match(SCORE);
  if (score) text = text.replace(SCORE, '');
  return {
    text: text.trim(),
    score: score ? score[1] : null,
    severity: severity ? severity[1].toLowerCase() : null,
  };
}

export function parseTicketDetails(details: string): ParsedTicketDetails | null {
  const parsed: ParsedTicketDetails = { intro: [], facts: [], questions: [], other: [] };
  let inQuestions = false;

  for (const raw of details.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (QUESTIONS_HEADING.test(line)) {
      inQuestions = true;
      continue;
    }
    const bullet = line.match(BULLET_LINE);
    if (inQuestions && bullet) {
      parsed.questions.push(parseQuestion(bullet[1]));
      continue;
    }
    const fact = !inQuestions ? line.match(FACT_LINE) : null;
    if (fact) {
      parsed.facts.push({ label: fact[1].trim(), value: fact[2].trim() });
      continue;
    }
    (parsed.facts.length || inQuestions ? parsed.other : parsed.intro).push(line);
  }

  return parsed.facts.length || parsed.questions.length ? parsed : null;
}
