"""Review-owned Skills Radar questions; Aptem ratings are reference data only.

The three answers per characteristic use the existing field validation,
participant permissions, answer version, signing and document mechanisms.
No source assessment or enrolment self-assessment is ever updated here.
"""
from copy import deepcopy
import json

from django.db import connections
from django.utils.html import strip_tags

SECTION_KEY = 'lms-skills-radar'
PURPOSE = 'skills_radar'

# The agreed five-point review scale, used only when Aptem supplied no
# questions. Imported five/eight-point scales and saved answers stay intact.
PROGRAMME_LEVELS = [
    {'value': '1', 'label': 'Never — I have no experience and need training.'},
    {'value': '2', 'label': 'Rarely — I have some basic experience but still need training.'},
    {'value': '3', 'label': 'Sometimes — I have limited experience and need further training.'},
    {'value': '4', 'label': 'Often — I am confident in my ability but would benefit from further training to be fully competent.'},
    {'value': '5', 'label': 'Always — I do not need any training as I am fully competent and can evidence my abilities.'},
]
PROGRAMME_KNOWLEDGE_LEVELS = [
    {'value': '1', 'label': 'No understanding — I have no knowledge and need training.'},
    {'value': '2', 'label': 'Slight understanding — I have some basic knowledge but still need training.'},
    {'value': '3', 'label': 'Moderate understanding — I have limited knowledge and need further training.'},
    {'value': '4', 'label': 'Strong understanding — I am confident in my understanding but would benefit from further training to be fully competent.'},
    {'value': '5', 'label': 'Significant understanding — I do not need any training as I am fully competent and can evidence my understanding.'},
]


def marker_section():
    return {'key': SECTION_KEY, 'title': 'Skills Radar', 'order': 1, 'fields': [{
        'key': SECTION_KEY + ':source', 'name': 'skills_radar', 'title': 'Skills Radar',
        'aptemType': 11, 'order': 0, 'mandatory': False, 'semanticKey': PURPOSE,
        'description': 'Review-specific learner and coach assessments against agreed goals.',
    }]}


def is_radar_section(section):
    return section.get('key') == SECTION_KEY and any(
        field.get('semanticKey') == PURPOSE or field.get('skillsRadar')
        for field in section.get('fields') or [])


def include_radar_section(snapshot):
    """The PR + Skills Radar family owns this section, without a master DB edit.

    Called only while producing a new/working snapshot. Persisted signed
    snapshots and source Aptem records never pass through this function.
    """
    if (snapshot.get('templateSource') or {}).get('family') != 'PR_SKILLS_RADAR':
        return snapshot
    if not any(is_radar_section(section) for section in snapshot.get('sections') or []):
        section = marker_section()
        section['order'] = max((s.get('order', 0) for s in snapshot.get('sections') or []), default=0) + 1
        snapshot.setdefault('sections', []).append(section)
    return snapshot


def definition_fingerprint_input(snapshot):
    result = deepcopy(snapshot)
    # Generated learner-specific question metadata is frozen with the review,
    # independently of the managed template's version. Never resync it away.
    result['sections'] = [{**marker_section(), 'order': s.get('order', 0)} if is_radar_section(s) else s
                          for s in result.get('sections') or []]
    return result


def preserve_radar_definition(latest, previous):
    frozen = next((s for s in previous.get('sections') or [] if is_radar_section(s)
                   and any(f.get('skillsRadar') for f in s['fields'])), None)
    if frozen:
        latest['sections'] = [{**deepcopy(frozen), 'order': s.get('order', 0)} if is_radar_section(s) else s
                              for s in latest.get('sections') or []]
    return latest


def _decode(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def read_source(learner_id):
    """Exact profile ownership, never email/title matching or a live Aptem call."""
    with connections['default'].cursor() as cursor:
        cursor.execute('''SELECT s.fields_json,r.last_extracted_at
            FROM "Learner".reviews r JOIN "Learner".review_sections s ON s.review_id=r.id
            WHERE r.learner_id=%s AND lower(btrim(r.review_type))='progress review (+ skills radar)'
              AND lower(btrim(s.section_name)) IN ('skill radar','skills radar')
              AND jsonb_typeof(s.fields_json::jsonb)='array'
              AND jsonb_array_length(s.fields_json::jsonb)>0
            ORDER BY r.last_extracted_at DESC NULLS LAST,r.id DESC,s.id DESC LIMIT 1''', [learner_id])
        row = cursor.fetchone()
    return (_decode(row[0]), row[1].isoformat() if row[1] else None) if row else ([], None)


def read_programme_source(learner_id):
    """Resolve this profile's applied programme KSBs, without email matching.

    Aptem programme IDs and curriculum programme IDs are different namespaces.
    Require one exact enrolled programme name; never compare those bare IDs or
    select a standard merely because its codes overlap.
    """
    from learner_api.ksb_sources import resolve_source
    with connections['default'].cursor() as cursor:
        cursor.execute('''SELECT p.programme_id,p.name,p.ksb_profile_source_id
            FROM "Learner".learners l JOIN curriculum.programmes p
              ON NULLIF(btrim(l.programme),'') IS NOT NULL
                 AND lower(btrim(p.name))=lower(btrim(l.programme))
            WHERE l.id=%s ORDER BY p.programme_id LIMIT 2''', [learner_id])
        rows = cursor.fetchall()
        if not rows:
            return None
        if len(rows) > 1:
            raise ValueError('The learner programme has more than one matching KSB source.')
        programme_id, programme_name, source_value = rows[0]
        if not source_value:
            # Preserve the existing explicit profile-to-programme association
            # used by the LMS when no source has been applied on the programme.
            cursor.execute('''SELECT id FROM curriculum.ksb_profiles
                WHERE COALESCE(is_active,true) AND
                  (programme_ids @> to_jsonb(%s::text) OR programme_ids @> to_jsonb(%s::text))
                ORDER BY id LIMIT 2''', [programme_id, programme_name])
            profiles = cursor.fetchall()
            if len(profiles) > 1:
                raise ValueError('The learner programme has more than one matching KSB profile.')
            source_value = profiles[0][0] if profiles else None
    if not source_value:
        return None
    source = resolve_source(source_value, using='default')
    return source if source.items else None


def _text(value):
    return strip_tags(str(value or '')).strip()[:4000]


def _positive_id(value):
    value = str(value or '')
    if not value.isdecimal() or int(value) <= 0:
        raise ValueError('The imported Skills Radar has an unverified characteristic identity.')
    return value


def build_section(fields, captured_at):
    """Copy definitions and labelled reference ratings, never new answers."""
    result = marker_section()
    generated, seen = [], set()
    for raw in fields or []:
        payload = _decode(raw.get('value')) if isinstance(raw, dict) else None
        if not isinstance(payload, dict) or not isinstance(payload.get('characteristics'), list):
            continue
        standard = payload.get('competency') or {}
        if not isinstance(standard, dict):
            raise ValueError('The imported Skills Radar has an invalid standard definition.')
        standard_id = _positive_id(standard.get('id'))
        for item in payload['characteristics']:
            if not isinstance(item, dict):
                raise ValueError('The imported Skills Radar has an invalid characteristic definition.')
            if item.get('competenceId') is not None and _positive_id(item['competenceId']) != standard_id:
                raise ValueError('The imported Skills Radar characteristic belongs to a different standard.')
            question_id = standard_id + ':' + _positive_id(item.get('id'))
            if question_id in seen:
                raise ValueError('The imported Skills Radar contains duplicate characteristic identities.')
            seen.add(question_id)
            if len(seen) > 500:
                raise ValueError('The imported Skills Radar exceeds the supported characteristic count.')
            levels, level_ids = {}, {}
            for level in item.get('levels') or []:
                if not isinstance(level, dict):
                    raise ValueError('The imported Skills Radar has an invalid assessment scale.')
                score = level.get('level')
                if type(score) is not int or not 0 <= score <= 100:
                    raise ValueError('The imported Skills Radar has an invalid assessment scale.')
                entry = {'value': str(score), 'label': _text(level.get('description') or level.get('shortDescription')) or f'Level {score}'}
                if score in levels and levels[score] != entry:
                    raise ValueError('The imported Skills Radar has conflicting assessment levels.')
                levels[score] = entry
                level_ids[str(level.get('characteristicsLevelId'))] = str(score)
            baseline = []
            for assessment in item.get('assessments') or []:
                if not isinstance(assessment, dict):
                    continue
                value = level_ids.get(str(assessment.get('characteristicsLevelId')))
                kind = assessment.get('assessmentType')
                if value is not None and kind in {'User', 'Admin'}:
                    baseline.append({'role': 'participant' if kind == 'User' else 'advisor',
                                     'value': value, 'at': str(assessment.get('completedDate') or '')})
            common = {'questionId': question_id, 'standardId': standard_id,
                      'standard': _text(standard.get('name')), 'question': _text(item.get('name')),
                      'levels': [levels[n] for n in sorted(levels)], 'capturedAt': captured_at,
                      'baselineScope': 'current_learner_competency_report'}
            for kind, role, label in (('learner', 'participant', 'Learner assessment'),
                                      ('coach', 'advisor', 'Coach assessment'), ('goal', 'advisor', 'Goal')):
                generated.append({'key': f'{SECTION_KEY}:{question_id}:{kind}',
                    'name': f'radar_{len(generated)}', 'title': f"{common['question']} — {label}",
                    'aptemType': 5, 'order': len(generated), 'mandatory': False,
                    'options': [str(n) for n in sorted(levels)],
                    'respondentRoles': ['participant'] if role == 'participant' else [],
                    'skillsRadar': {**common, 'kind': kind, 'role': role,
                                    **({'baseline': baseline} if kind == 'coach' else {})}})
    if generated:
        result['fields'] = generated
    else:
        result['fields'][0]['description'] = 'No verified imported Skills Radar questions and assessment scales are available for this learner.'
    return result


def build_programme_section(source, levels=None):
    """Freeze programme question definitions, never enrolment/saved ratings."""
    section = marker_section()
    generated, codes = [], set()
    standard_id = 'programme:' + source.source_value
    for item in source.items:
        code = str(item.get('code') or '').strip().upper()
        description = _text(item.get('description') or item.get('title'))
        if not code or code[0] not in {'K', 'S', 'B'} or not description:
            raise ValueError('The programme KSB source has an incomplete question definition.')
        if code in codes:
            raise ValueError('The programme KSB source contains duplicate question codes.')
        codes.add(code)
        if len(codes) > 500:
            raise ValueError('The programme KSB source exceeds the supported question count.')
        question_id = standard_id + ':' + code
        question = f'{code}: {description}'
        item_levels = levels if levels is not None else (
            PROGRAMME_KNOWLEDGE_LEVELS if code.startswith('K') else PROGRAMME_LEVELS)
        for kind, role, label in (('learner', 'participant', 'Learner assessment'),
                                  ('coach', 'advisor', 'Coach assessment'), ('goal', 'advisor', 'Goal')):
            generated.append({'key': f'{SECTION_KEY}:{question_id}:{kind}',
                'name': f'programme_radar_{len(generated)}', 'title': f'{question} — {label}',
                'aptemType': 5, 'order': len(generated), 'mandatory': False,
                'options': [level['value'] for level in item_levels],
                'respondentRoles': ['participant'] if role == 'participant' else [],
                'skillsRadar': {'questionId': question_id, 'standardId': standard_id,
                    'standard': _text(source.label), 'question': question, 'code': code,
                    'kind': kind, 'role': role, 'levels': deepcopy(item_levels),
                    'origin': 'programme_ksb', 'sourceId': source.source_value}})
    if not generated:
        raise ValueError('No KSB questions are available for the learner programme.')
    section['fields'] = generated
    return section


def _refresh_unanswered_knowledge_labels(snapshot, answers, answer_audit):
    """Correct the initial generic fallback labels only before assessment.

    Never reinterpret a saved/cleared assessment, imported scale, custom scale,
    question definition or numeric score. Only the editable sync caller supplies
    answers; frozen/participant reads continue using their stored definitions.
    """
    fields = [field for section in snapshot.get('sections') or [] if is_radar_section(section)
              for field in section.get('fields') or []]
    groups = {}
    for field in fields:
        metadata = field.get('skillsRadar') or {}
        if metadata.get('origin') == 'programme_ksb':
            groups.setdefault(metadata.get('questionId'), []).append(field)
    changed_keys = set()
    for group in groups.values():
        if (len(group) != 3 or
                {field['skillsRadar'].get('kind') for field in group} != {'learner', 'coach', 'goal'}):
            continue
        if any(answers.get(field['key']) not in (None, '') or answer_audit.get(field['key']) for field in group):
            continue
        if all(str(field['skillsRadar'].get('code', '')).startswith('K')
               and field['skillsRadar'].get('levels') == PROGRAMME_LEVELS
               and field.get('options') == ['1', '2', '3', '4', '5'] for field in group):
            changed_keys.update(field['key'] for field in group)
    if not changed_keys:
        return snapshot
    result = deepcopy(snapshot)
    for section in result['sections']:
        for field in section.get('fields') or []:
            if field['key'] in changed_keys:
                field['skillsRadar']['levels'] = deepcopy(PROGRAMME_KNOWLEDGE_LEVELS)
    return result


def expand_snapshot(snapshot, learner_id, *, answers=None, answer_audit=None):
    if (snapshot.get('templateSource') or {}).get('family') != 'PR_SKILLS_RADAR':
        return snapshot
    if not any(is_radar_section(s) for s in snapshot.get('sections') or []):
        return snapshot
    if any(f.get('skillsRadar') for s in snapshot['sections'] if is_radar_section(s) for f in s['fields']):
        return (_refresh_unanswered_knowledge_labels(snapshot, answers, answer_audit or {})
                if answers is not None else snapshot)
    fields, captured = read_source(learner_id)
    try:
        section = build_section(fields, captured)
        if not any(field.get('skillsRadar') for field in section['fields']):
            source = read_programme_source(learner_id)
            if source is not None:
                section = build_programme_section(source)
            else:
                section['fields'][0]['description'] = (
                    'Skills Radar questions are unavailable. No imported questions or mapped '
                    'programme KSB definitions were found for this learner.')
    except ValueError as exc:
        # Keep the rest of the review usable, without presenting partial or
        # invented assessments. An unexpanded marker is retried on next open.
        section = marker_section()
        section['fields'][0]['description'] = f'Skills Radar is unavailable: {exc} Ask a template administrator to check the question source.'
    result = deepcopy(snapshot)
    result['sections'] = [{**section, 'order': s.get('order', 0)} if is_radar_section(s) else s
                          for s in result['sections']]
    return result


def rating_status(coach, goal):
    if coach in (None, '') or goal in (None, ''):
        return 'Not assessed'
    return 'Achieved' if int(coach) >= int(goal) else 'Working Toward'


def check_role_edits(snapshot, previous, incoming, role):
    for section in snapshot.get('sections') or []:
        for field in section.get('fields') or []:
            metadata = field.get('skillsRadar')
            key = field.get('key')
            if not metadata:
                continue
            if (incoming.get(key) or None) != (previous.get(key) or None) and metadata['role'] != role:
                raise ValueError('Skills Radar assessments can only be changed by their assigned respondent; goals belong to the coach.')
