"""Versioned Portfolio Sampling form from the supplied Quality 2.docx."""
TEMPLATE_ID = 'portfolio-sampling-v1'
RATINGS = ('gold', 'green', 'amber', 'red', 'na')
SECTIONS = [
    ('progress', 'Progress reviews', [
        'Progress reviews take place regularly and in line with KBC expectations.',
        'Reviews involve the learner, employer and coach in a meaningful discussion about progress, including KSB development, workplace application and progress against previous targets.']),
    ('monthly', 'Monthly Coaching Meetings', [
        'Monthly coaching meetings take place consistently.',
        'Coaching meetings include meaningful discussion about the learner’s progress, barriers, workload, confidence and agreed actions.',
        'There is a clear impact of the learner’s apprenticeship on their workplace role.']),
    ('reflections', 'Curriculum Engagement and Monthly LMS Reflections', [
        'The learner completes the monthly Knowledge LMS Reflection in line with curriculum expectations.',
        'The learner completes the monthly Skills and Behaviours LMS Reflection in line with curriculum expectations.',
        'LMS reflections clearly show how the learner applies learning in their workplace role and the positive impact this has on their employer, team, stakeholders, projects or workplace practice.']),
    ('feedback', 'Coach Feedback on LMS Reflections and Evidence', [
        'Feedback is provided within expected timescales.',
        'Feedback supports improvement in the learner’s evidence, including English and maths skills where relevant, portfolio quality, KSB coverage, reflection and preparation for EPA.',
        'Feedback supports the learner to recognise the impact of their learning, including business benefit, workplace application, strengths, career progression and professional next steps.']),
    ('epa', 'EPA Preparation and Portfolio Development', [
        'The learner is building appropriate portfolio evidence that links to the relevant knowledge, skills and behaviours.']),
    ('support', 'Additional Learning Needs and Barriers', [
        'The learner’s additional learning needs, barriers or support needs are identified early.',
        'Reasonable adjustments or support strategies are in place where required.']),
    ('safeguarding', 'Safeguarding Awareness', [
        'The learner knows how to raise a safeguarding concern and understands how safeguarding applies within the context of their workplace role.']),
    ('prevent', 'Prevent and Radicalisation', [
        'The learner understands what radicalisation means at an appropriate level.']),
    ('values', 'British Values', ['The learner understands British values at an appropriate level.']),
]
CRITERIA = {f'{key}-{index+1}': text for key, _, items in SECTIONS for index, text in enumerate(items)}
IMAGE_SECTIONS = ('progress', 'monthly', 'reflections', 'feedback', 'support')
DESCRIPTORS = {
    'gold': 'Present and high quality. Evidence is strong, personalised, impactful and clearly supports the learner to make sustained progress.',
    'green': 'Present and effective. Evidence shows the learner is receiving appropriate support, guidance and feedback.',
    'amber': 'Present but weak. There is some evidence, but quality, consistency, personalisation or impact is limited.',
    'red': 'Not present. There is little or no evidence that this is happening for the learner.',
    'na': 'Not applicable to this review.',
}


def template():
    return {'id': TEMPLATE_ID, 'title': 'Portfolio Sampling Feedback Form',
        'sections': [{'id': key, 'title': title, 'screenshots': key in IMAGE_SECTIONS,
                      'criteria': [{'id': f'{key}-{index+1}', 'text': text} for index, text in enumerate(items)]}
                     for key, title, items in SECTIONS], 'ratings': DESCRIPTORS}


class InvalidReview(ValueError):
    pass


def _text(value, maximum=1000):
    if not isinstance(value, str) or len(value) > maximum or '\x00' in value:
        raise InvalidReview('A form value is invalid or too long.')
    return value.strip()


def validate_form(value, status):
    from datetime import date
    if status not in ('draft', 'completed') or not isinstance(value, dict) or set(value) - {'header', 'criteria', 'actions', 'images', 'sources'}:
        raise InvalidReview('Choose a valid review status and form.')
    header = value.get('header', {})
    fields = ('employer', 'programme', 'activityDate', 'startDate', 'endDate')
    if not isinstance(header, dict) or set(header) - set(fields):
        raise InvalidReview('The form header is invalid.')
    header = {key: _text(header.get(key, ''), 300) for key in fields}
    for key in ('activityDate', 'startDate', 'endDate'):
        if header[key]:
            try:
                date.fromisoformat(header[key])
            except ValueError:
                raise InvalidReview('Enter valid form dates.')
    if header['startDate'] and header['endDate'] and header['endDate'] < header['startDate']:
        raise InvalidReview('Planned end date must follow the start date.')
    answers = value.get('criteria', {})
    if not isinstance(answers, dict) or set(answers) - set(CRITERIA):
        raise InvalidReview('The form contains an unknown criterion.')
    cleaned = {}
    for key in CRITERIA:
        row = answers.get(key, {})
        if not isinstance(row, dict) or set(row) - {'rating', 'evidence'} or row.get('rating', '') not in ('', *RATINGS):
            raise InvalidReview('Choose one valid rating for each criterion.')
        rating, evidence = row.get('rating', ''), _text(row.get('evidence', ''), 6000)
        if status == 'completed' and (not rating or (rating != 'na' and not evidence)):
            raise InvalidReview('Complete each rating and explain the evidence before completing the review.')
        cleaned[key] = {'rating': rating, 'evidence': evidence}
    actions = value.get('actions', [])
    if not isinstance(actions, list) or len(actions) > 30:
        raise InvalidReview('The action plan is too large.')
    plan = []
    for row in actions:
        if not isinstance(row, dict) or set(row) - {'action', 'outcome', 'supportedBy', 'dueDate'}:
            raise InvalidReview('An action plan row is invalid.')
        item = {key: _text(row.get(key, ''), 3000 if key in ('action', 'outcome') else 300)
                for key in ('action', 'outcome', 'supportedBy', 'dueDate')}
        if item['dueDate']:
            try:
                date.fromisoformat(item['dueDate'])
            except ValueError:
                raise InvalidReview('An action deadline is invalid.')
        if any(item.values()):
            if status == 'completed' and not all(item.values()):
                raise InvalidReview('Complete all four fields for each SMART action.')
            plan.append(item)
    images = value.get('images', {})
    if not isinstance(images, dict) or set(images) - set(IMAGE_SECTIONS):
        raise InvalidReview('The screenshot section is invalid.')
    from uuid import UUID
    cleaned_images = {}
    for section, identities in images.items():
        if not isinstance(identities, list) or len(identities) > 2:
            raise InvalidReview('Use up to two screenshots per section.')
        try:
            cleaned_images[section] = list(dict.fromkeys(str(UUID(identity)) for identity in identities))
        except (ValueError, TypeError, AttributeError):
            raise InvalidReview('A screenshot identity is invalid.')
    sources = value.get('sources', [])
    if not isinstance(sources, list) or any(item not in ('recording','transcript','ai','portfolio','other') for item in sources):
        raise InvalidReview('Choose valid evidence sources.')
    return {'header': header, 'criteria': cleaned, 'actions': plan, 'images': cleaned_images, 'sources':list(dict.fromkeys(sources))}
