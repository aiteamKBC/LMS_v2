"""Conservative, deterministic topic suggestions. No database, network or AI.

Rules identify lexical evidence, not meeting completion or coach conduct. Shared
template terms and bare type labels cannot establish a type or a mixed session.
"""
import re
import unicodedata
from collections import defaultdict

VERSION = 'template-keywords-v1'
FAMILIES = ('MCM', 'PR', 'SUPPORT')
STOP = set(('a an the and or of to for from in on at by with as is are was were be been being '
            'do does did how what which when where why who please describe discuss tell about '
            'your our their this that these those any each all have has had you we i it its '
            'في من على الي عن مع و او ان اي هو هي هذا هذه ذلك ما ماذا كيف متي هل اذكر ناقش').split())
VARIANTS = {'goals': 'goal', 'actions': 'action', 'skills': 'skill', 'plans': 'plan', 'months': 'month',
            'monthly': 'month', 'reviews': 'review', 'meetings': 'meeting', 'barriers': 'barrier',
            'targets': 'target', 'objectives': 'objective', 'achievements': 'achievement',
            'employers': 'employer', 'learners': 'learner', 'students': 'student',
            'discussed': 'discuss', 'reviewed': 'review', 'reviewing': 'review'}
ALIASES = {'MCM': ('mcm', 'monthly coaching meeting', 'monthly coaching review', 'اجتماع الكوتشينج الشهري'),
           'PR': ('pr', 'br', 'progress review', 'مراجعة التقدم'),
           'SUPPORT': ('student support', 'learner support', 'جلسة دعم الطالب', 'دعم الطالب')}
NON_DISCUSSION = re.compile(
    r"\b(?:not|never|no|didn['’]?t|don['’]?t|won['’]?t|haven['’]?t|wasn['’]?t|isn['’]?t|"
    r"next meeting|next review|next month|next week|tomorrow|will discuss|we will|we['’]ll|"
    r"(?:template|form|question|agenda) (?:says|asks|includes|reads|is))\b"
    r'|(?:\b(?:مش|مفيش|مافيش|لن|لم|ليس)\b|الاجتماع القادم|الاسبوع القادم|الشهر القادم|هنتكلم|السؤال بيقول)',
    re.IGNORECASE)


def tokens(text):
    text = unicodedata.normalize('NFKC', str(text)).casefold()
    text = ''.join(char for char in text if not unicodedata.combining(char) and char != '\u0640')
    text = text.translate(str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ى': 'ي', 'ة': 'ه'}))
    return tuple(VARIANTS.get(word, word) for word in re.findall(r'[^\W_]+', text, re.UNICODE))


def content_tokens(text):
    return tuple(word for word in tokens(text) if word not in STOP and not word.isdecimal())


def grams(words):
    for size in (2, 3):
        for position in range(len(words) - size + 1):
            yield words[position:position + size]


def units(text):
    # Bound quotations, not the analysis: the complete saved transcript is read.
    for sentence in re.split(r'[\n.!?؟؛;]+', text):
        sentence = sentence.strip()
        if NON_DISCUSSION.search(sentence) or NON_DISCUSSION.search(' '.join(tokens(sentence))):
            continue
        while len(sentence) > 230:
            end = sentence.rfind(' ', 0, 230)
            end = end if end > 0 else 230
            yield sentence[:end]
            sentence = sentence[end:].lstrip()
        if sentence:
            yield sentence


def contains(words, phrase):
    return any(words[index:index + len(phrase)] == phrase for index in range(len(words) - len(phrase) + 1))


def classify_keywords(transcript, title, references, *, unlinked_excluded=False):
    phrase_sources = defaultdict(set)
    reference_map = {row['id']: row for row in references}
    type_names = {content_tokens(alias) for values in ALIASES.values() for alias in values}
    for reference in references:
        for prompt in reference['prompts']:
            words = content_tokens(prompt)
            if not words:
                continue
            for phrase in grams(words):
                # A type's name is a mention, never a distinctive content topic.
                if any(contains(name, phrase) for name in type_names):
                    continue
                phrase_sources[phrase].add((reference['family'], reference['id'], words))
    index = {phrase: sources for phrase, sources in phrase_sources.items()
             if len({family for family, _, _ in sources}) == 1}
    evidence, mentions = {family: {} for family in FAMILIES}, set()
    aliases = {family: [tokens(alias) for alias in values] for family, values in ALIASES.items()}
    for quote in units(transcript):
        raw_words = tokens(quote)
        for family in FAMILIES:
            if any(contains(raw_words, alias) for alias in aliases[family]):
                mentions.add(family)
        words = tuple(word for word in raw_words if word not in STOP and not word.isdecimal())
        for phrase in grams(words):
            for family, reference_id, prompt in index.get(phrase, ()):
                item = evidence[family].setdefault(phrase, {'quote': quote, 'referenceIds': set(), 'prompts': set()})
                item['referenceIds'].add(reference_id)
                item['prompts'].add(prompt)
    title_words = tokens(title)
    types, signals = [], []
    for family in FAMILIES:
        # Nested/overlapping phrases count as one topic, even when repeated
        # under different template questions or throughout the transcript.
        chosen, used_prompts = [], set()
        for phrase, item in sorted(evidence[family].items(), key=lambda pair: (-len(pair[0]), pair[0])):
            words = set(phrase)
            if not item['prompts'] - used_prompts:
                continue
            if any(len(words & set(other)) / min(len(words), len(set(other))) >= 2 / 3 for other, _ in chosen):
                continue
            chosen.append((phrase, item))
            used_prompts.update(item['prompts'])
            if len(chosen) == 6:
                break  # Six representative topics suffice for a review suggestion.
        quotes = list(dict.fromkeys(item['quote'] for _, item in chosen))[:3]
        terms = [' '.join(phrase) for phrase, _ in chosen][:6]
        reference_ids = sorted({key for _, item in chosen for key in item['referenceIds']})
        has_template = any(row['family'] == family for row in references)
        signals.append({'type': family, 'topicCount': len(chosen), 'matchedTerms': terms, 'evidence': quotes,
                        'templateBased': has_template, 'transcriptMentioned': family in mentions,
                        'titleMentioned': any(contains(title_words, alias) for alias in aliases[family])})
        if len(chosen) >= 2:
            types.append({'type': family, 'confidence': 'medium' if len(chosen) >= 3 and len(quotes) >= 2 else 'low',
                          'reason': 'Distinct topic phrases from at least two template prompts occur in the saved transcript; context requires human review.',
                          'evidence': quotes, 'referenceIds': reference_ids, 'templateBased': True})
    return {'types': types, 'mixed': len(types) > 1, 'insufficientEvidence': not bool(types),
            'uncertainty': 'Keyword matching is a conservative heuristic, not a calibrated probability or proof of meeting type. '
                           'Paraphrases, translations and complex negation can be missed. Shared phrases, repeated mentions and titles alone do not establish a type. '
                           'No Student Support classification is inferred without its template.',
            'sampled': False, 'unlinkedTranscriptExcluded': unlinked_excluded,
            'title': title, 'model': VERSION, 'reviewOnly': True,
            'references': [{key: row[key] for key in ('id', 'name', 'family', 'linked')} for row in reference_map.values()],
            'keywordSignals': signals, 'analysedCharacters': len(transcript)}
