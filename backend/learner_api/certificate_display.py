"""Render current certificate details without rewriting the issued record."""
from copy import deepcopy


CORRECTION_FIELDS = ('learnerName', 'courseTitle', 'title', 'bodyText', 'instructorName', 'instructorLabel')


def editable_values(certificate):
    snapshot = certificate.get('snapshot') or {}
    learner = snapshot.get('learner') or {}
    layout = snapshot.get('layoutConfig') or {}
    return {
        'learnerName': learner.get('name') or '',
        'courseTitle': snapshot.get('moduleTitle') or certificate.get('moduleTitle') or learner.get('programme') or snapshot.get('programme') or '',
        'title': snapshot.get('certificateTitle') or '',
        'bodyText': snapshot.get('bodyText') or '',
        'instructorName': layout.get('instructorName', ''),
        'instructorLabel': layout.get('instructorLabel', 'Instructor'),
    }


def certificate_display(certificate, template, *, learner=None, progress=None, overrides=None):
    result = deepcopy(certificate)
    snapshot = result.setdefault('snapshot', {})
    result['progressAtIssue'] = certificate.get('progressAtIssue', certificate['progressPercent'])
    result['otjHours'] = snapshot.get('otjHours')
    result['pdfBlobUrl'] = ''  # Downloads must render the current copy.
    if template:
        snapshot.update(certificateTitle=template['title'], bodyText=template['bodyText'],
                        layoutConfig=deepcopy(template['layoutConfig']))
        result.update(displayTemplateId=template['id'], displayTemplateVersion=template['version'])
    if learner:
        current = snapshot.setdefault('learner', {})
        for key in ('name', 'programme'):
            if learner.get(key):
                current[key] = learner[key]
        if learner.get('programme'):
            snapshot['programme'] = learner['programme']
    if progress:
        result['progressPercent'] = progress['progressPercent']
        # Unavailable OTJ hours stay unavailable, even if an older copy had a value.
        result['otjHours'] = snapshot['otjHours'] = progress.get('otjHours')
        for key in ('progressPercent', 'trackableDone', 'trackableTotal'):
            snapshot[key] = progress[key]
        if progress.get('moduleTitle'):
            result['moduleTitle'] = snapshot['moduleTitle'] = progress['moduleTitle']

    # Membership checks deliberately preserve explicitly cleared signatory fields.
    overrides = {key: value for key, value in (overrides or {}).items()
                 if key in CORRECTION_FIELDS and isinstance(value, str)}
    snapshot['certificateOverrides'] = overrides
    if 'learnerName' in overrides:
        snapshot.setdefault('learner', {})['name'] = overrides['learnerName']
    if 'courseTitle' in overrides:
        if result.get('moduleRef'):
            result['moduleTitle'] = snapshot['moduleTitle'] = overrides['courseTitle']
        else:
            snapshot['programme'] = overrides['courseTitle']
            snapshot.setdefault('learner', {})['programme'] = overrides['courseTitle']
    for field, key in (('title', 'certificateTitle'), ('bodyText', 'bodyText')):
        if field in overrides:
            snapshot[key] = overrides[field]
    for field in ('instructorName', 'instructorLabel'):
        if field in overrides:
            snapshot.setdefault('layoutConfig', {})[field] = overrides[field]
    return result
