// Coaching-Sessions report spelling conventions.
const BRITISH_SPELLINGS: Array<[RegExp, string]> = [
  [/\bMonthly Coaching Reviews\b/gi, 'Monthly Coaching Meetings'],
  [/\bMonthly Coaching Review\b/gi, 'Monthly Coaching Meeting'],
  [/\bMCR\b/g, 'MCM'],
  [/\bbehavioral\b/gi, 'behavioural'],
  [/\bbehaviors\b/gi, 'behaviours'],
  [/\bbehavior\b/gi, 'behaviour'],
  [/\bprograms\b/gi, 'programmes'],
  [/\bprogram\b/gi, 'programme'],
  [/\borganizations\b/gi, 'organisations'],
  [/\borganization\b/gi, 'organisation'],
  [/\borganized\b/gi, 'organised'],
  [/\borganizing\b/gi, 'organising'],
  [/\borganize\b/gi, 'organise'],
  [/\banalyzed\b/gi, 'analysed'],
  [/\banalyzing\b/gi, 'analysing'],
  [/\banalyze\b/gi, 'analyse'],
  [/\brecognized\b/gi, 'recognised'],
  [/\brecognizing\b/gi, 'recognising'],
  [/\brecognize\b/gi, 'recognise'],
  [/\bstandardized\b/gi, 'standardised'],
  [/\bstandardizing\b/gi, 'standardising'],
  [/\bstandardize\b/gi, 'standardise'],
  [/\bsummarized\b/gi, 'summarised'],
  [/\bsummarizing\b/gi, 'summarising'],
  [/\bsummarize\b/gi, 'summarise'],
  [/\bcustomized\b/gi, 'customised'],
  [/\bcustomizing\b/gi, 'customising'],
  [/\bcustomize\b/gi, 'customise'],
  [/\benrollment\b/gi, 'enrolment'],
  [/\benrolling\b/gi, 'enrolling'],
  [/\benroll\b/gi, 'enrol'],
  [/\bfavorites\b/gi, 'favourites'],
  [/\bfavorite\b/gi, 'favourite'],
  [/\butilization\b/gi, 'utilisation'],
  [/\bcentered\b/gi, 'centred'],
  [/\bcenters\b/gi, 'centres'],
  [/\bcenter\b/gi, 'centre'],
  [/\bcolors\b/gi, 'colours'],
  [/\bcolor\b/gi, 'colour'],
  [/\blabor\b/gi, 'labour'],
];

function matchCase(source: string, replacement: string) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) {
    return `${replacement[0]?.toUpperCase() ?? ''}${replacement.slice(1)}`;
  }
  return replacement;
}

export function toBritishEnglish(value: string) {
  return BRITISH_SPELLINGS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, (match) => matchCase(match, replacement)),
    value,
  );
}
