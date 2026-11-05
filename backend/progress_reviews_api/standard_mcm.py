"""Real review-pack data in the manager's MCM template; no synthetic outcomes."""
import json
import re

from learner_api.standard_mcm_presentation import FORMAT, build_standard_deck
from .review_pack import evidence_pool_keys


def _shown(value):
    return 'Not recorded.' if value is None or value == '' else str(value)


def _percent(value):
    return _shown(value) if value is None or value == '' else f'{value}%'


def _highlights(value, budget=220):
    parts = list(dict.fromkeys(p.strip() for p in re.split(r'\n+|(?<=[.!?])\s+', _shown(value)) if p.strip()))[:3]
    limit = budget // max(1, len(parts))
    return '\n'.join(p if len(p) <= limit else (p[:limit - 1].rsplit(' ', 1)[0] or p[:limit - 1]) + '…' for p in parts)


def sections_from_pack(pack):
    learner, review = pack.get('learner') or {}, pack.get('review') or {}
    evidence = pack['slide_evidence'] if 'slide_evidence' in pack else [item for key in evidence_pool_keys(pack) for item in pack.get(key) or []]
    ksbs, progress, otj, attendance = (pack.get(k) or {} for k in ('ksbs', 'progress', 'otj', 'attendance'))
    # Never copy private storage refs, expiring SAS credentials or account emails
    # into speaker notes. Preserve the full learning/evidence text instead.
    evidence_notes = [{k: e.get(k) for k in ('evidence_title', 'evidence_summary', 'evidence_date', 'ksb_mappings', 'evidence_status', 'manager_verification_status')} for e in evidence]
    ev_text = '\n'.join(f"{_shown(e.get('evidence_title'))}: {_shown(e.get('evidence_summary'))}" for e in evidence)
    modules = '\n'.join(f"{_shown(m.get('module'))}: {_percent(m.get('completion_percentage'))}" for m in pack.get('lms_modules') or [])
    actions = '\n'.join(f"{_shown(a.get('title'))}: {_shown(a.get('detail'))}\nOwner: {_shown(a.get('owner'))}; due: {_shown(a.get('due_by'))}" for a in pack.get('actions') or [])
    claim_text = lambda key: '\n'.join(f"{_shown(c.get('code'))}: {_shown(c.get('description'))}" for c in ksbs.get(key) or [])
    def card(heading, value, budget=220):
        return f'{heading}\n{_highlights(value, budget)}'
    def section(layout, title, cards, notes):
        return {'title': title, 'templateSlide': layout, 'body': '\n\n'.join(cards), 'notes': notes if isinstance(notes, str) else json.dumps(notes, ensure_ascii=False, indent=2, default=str)}
    slides = [
        section(1, 'Learner Monthly Coaching Meeting', [card('Review details', f"Month: {_shown(review.get('review_date'))}\nLearner: {_shown(learner.get('full_name'))}", 100), card('Highlights', modules or ev_text, 120)], {'learner': {k: learner.get(k) for k in ('full_name', 'programme', 'employer', 'coach')}, 'period': {k: review.get(k) for k in ('review_date', 'review_period_start', 'review_period_end')}}),
        section(2, '1. What I learned this month', [card('Topics & modules', modules), card('Knowledge', claim_text('knowledge_evidenced')), card('Skills & behaviours', claim_text('skills_evidenced') + '\n' + claim_text('behaviours_evidenced'))], {'modules': pack.get('lms_modules') or [], 'knowledge': ksbs.get('knowledge_evidenced') or []}),
        section(3, '2. Applying my learning at work', [card('My work', ev_text, 180), card('Evidence', '\n'.join(_shown(e.get('evidence_title')) for e in evidence), 180), card('Recorded outcomes', '\n'.join(_shown(e.get('evidence_summary')) for e in pack.get('workplace_activities') or []))], {'work': evidence_notes}),
        section(4, '3. KSBs I have demonstrated', [card('Knowledge', claim_text('knowledge_evidenced')), card('Skills', claim_text('skills_evidenced')), card('Behaviours', claim_text('behaviours_evidenced'))], ksbs),
        section(5, '4. Resources and evidence', [card('Supporting evidence', ev_text), card('LMS modules', modules), card('Engagement', attendance.get('engagement_notes'))], {'evidence': evidence_notes, 'engagement': attendance.get('engagement_notes')}),
        section(6, '5. Workplace impact', [card('Recorded application', '\n'.join(_shown(e.get('evidence_summary')) for e in pack.get('workplace_activities') or [])), card('Assignment evidence', '\n'.join(_shown(e.get('evidence_summary')) for e in pack.get('assignments') or [])), card('Next priorities', actions)], {'assignments': [{k: e.get(k) for k in ('evidence_title', 'evidence_summary', 'ksb_mappings')} for e in pack.get('assignments') or []]}),
        section(2, '6. Monthly progress and engagement', [card('Programme progress', f"Current: {_percent(progress.get('current_programme_progress_percentage'))}\nTarget: {_percent(progress.get('target_progress_percentage'))}\nNext: {_shown(progress.get('next_module'))}"), card('Off-the-job hours', f"Recorded: {_shown(otj.get('completed_otj_hours'))}\nRequired: {_shown(otj.get('required_otj_hours_to_date'))}\nStatus: {_shown(otj.get('risk_status'))}"), card('Attendance & engagement', f"Attendance: {_percent(attendance.get('attendance_percentage'))}\n{_shown(attendance.get('engagement_notes'))}")], {'attendance': attendance, 'progress': progress, 'otj': otj, 'source_warnings': pack.get('source_warnings') or []}),
    ]
    # Keep the four image slots supported by the existing evidence editor.
    # Actual evidence is placed inside the reference's existing card areas.
    pictured = evidence[:4]
    if any(e.get('image_or_screenshot_link') not in (None, '', 'Not available') for e in pictured):
        for start in range(0, len(pictured), 3):
            items = pictured[start:start + 3]
            gallery = section(2, f'{len(slides)}. My evidence', [card(_shown(e.get('evidence_title'))[:40], e.get('evidence_summary')) for e in items], [{k: e.get(k) for k in ('evidence_title', 'evidence_summary', 'ksb_mappings')} for e in items])
            gallery['evidenceImages'] = [e.get('image_or_screenshot_link') for e in items]
            slides.append(gallery)
    volume = sum(len(s['notes']) for s in slides)
    target = 12 if volume > 24000 or len(evidence) > 12 else 10 if volume > 7000 or len(evidence) > 5 else max(8, len(slides) + 1)
    while len(slides) < target - 1:
        start = (len(slides) - 7) * 3
        values = evidence_notes[start:start + 3]
        detail = '\n'.join(f"{_shown(e.get('evidence_title'))}: {_shown(e.get('evidence_summary'))}" for e in values) or actions or modules
        slides.append(section(2, f'{len(slides)}. Further learning highlights', [card('Learning', detail), card('Next focus', progress.get('next_module')), card('Agreed actions', actions)], detail))
    slides.append(section(7, f'{len(slides)}. Reflection and next steps', [card('Reflection', attendance.get('engagement_notes'), 350), card('Next month focus', actions, 350)], {'actions': pack.get('actions') or [], 'epa': pack.get('epa') or {}}))
    slides.extend(pack.get('manual_slides') or [])
    return slides


def generate(pack, *, fetch_image):
    return build_standard_deck(sections_from_pack(pack), fetch_image=fetch_image)
