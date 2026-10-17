"""Validate newly imported/generated quizzes without changing historic grading."""
import json
import re
from .answer_keys import choice_label, quiz_publication_error


class InvalidQuizIntake(ValueError):
    pass


def key_indexes(options, key, *, ordered=False, multiple=False):
    """Resolve complete text before positional keys; reject partial/unknown keys."""
    key = str(key or '').strip()
    labels = [choice_label(value) for value in options]
    if not key:
        return []
    positional = re.fullmatch(r'(?:[A-Z]|[1-9]\d*)(?:\s*(?:[,;/|>]|->|=>)\s*(?:[A-Z]|[1-9]\d*))*', key, re.I)
    if not positional and choice_label(key) in labels:
        return [i for i, label in enumerate(labels) if label == choice_label(key)]
    tokens = re.split(r'\s*(?:->|=>|[,;/|>])\s*', key) if positional else re.split(r'\s*(?:->|=>|[,;|])\s*', key) if ordered or multiple else [key]
    result = []
    for token in tokens:
        annotated = re.fullmatch(r'([A-Z]|[1-9]\d*)\s*[).:\-\u2013\u2014]\s*(.+)', token, re.I)
        position = annotated[1] if annotated else token
        index = int(position) - 1 if position.isdigit() else ord(position.upper()) - 65 if re.fullmatch('[A-Z]', position, re.I) else None
        if index is not None:
            if index >= len(options) or index < 0 or not labels[index]:
                return []
            if annotated and choice_label(annotated[2]) != labels[index]:
                return []
        else:
            matches = [i for i, label in enumerate(labels) if label == choice_label(token)]
            if len(matches) != 1:
                return []
            index = matches[0]
        result.append(index)
    expected = {index for index, label in enumerate(labels) if label}
    if ordered and (len(result) != len(expected) or set(result) != expected):
        return []
    return result


def intake_error(questions):
    if not isinstance(questions, list) or any(not isinstance(q, dict) for q in questions):
        return 'Questions must be a list of question objects.'
    for index, question in enumerate(questions, 1):
        if not isinstance(question.get('text'), str) or not question['text'].strip():
            return f'Question {index}: Add question text.'
        answers = question.get('answers')
        if not isinstance(answers, list) or any(not isinstance(a, dict) for a in answers):
            return f'Question {index}: Answers must be a list of answer objects.'
        if any(not isinstance(a.get('text'), str) or not a['text'].strip() or type(a.get('isCorrect')) is not bool for a in answers):
            return f'Question {index}: Each answer needs nonblank text and a boolean correct flag.'
    if error := quiz_publication_error(questions):
        return error
    for index, question in enumerate(questions, 1):
        kind = question['type']
        answers = question['answers']
        if kind in {'single_choice', 'multiple_choice', 'true_false'} and len(answers) < 2:
            return f'Question {index}: Add at least two answer options.'
        if kind == 'true_false' and len(answers) != 2:
            return f'Question {index}: A true/false question needs exactly two answer options.'
        labels = [choice_label(a['text']) for a in answers]
        if len(set(labels)) != len(labels):
            return f'Question {index}: Remove duplicate answer rows.'
        if kind in {'fill_gap', 'keywords', 'ordering'} and not all(a['isCorrect'] for a in answers):
            return f'Question {index}: {kind} rows must contain only accepted answers or steps in the correct order.'
        if kind in {'matching', 'image_matching'}:
            for answer in answers:
                text = answer['text'].strip()
                if kind == 'image_matching' and text.startswith('{'):
                    try:
                        pair = json.loads(text)
                    except ValueError:
                        pair = None
                    valid = (isinstance(pair, dict) and isinstance(pair.get('imageUrl'), str)
                             and pair.get('kind', 'image_matching_pair') == 'image_matching_pair'
                             and pair['imageUrl'].lower().startswith(('http://', 'https://', 'data:image/'))
                             and str(pair.get('match') or pair.get('right') or '').strip())
                else:
                    parts = re.split(r'\s*(?:->|=>|=)\s*', text, maxsplit=1)
                    valid = len(parts) == 2 and all(part.strip() for part in parts)
                    if kind == 'image_matching':
                        valid = valid and parts[0].lower().startswith(('http://', 'https://', 'data:image/'))
                if not valid:
                    return f'Question {index}: Each {kind} row needs a complete prompt/image and matching answer.'
    return None
