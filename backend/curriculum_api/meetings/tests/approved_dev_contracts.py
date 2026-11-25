"""Pinned upstream contracts for the explicitly accepted study-week changes.

The reference comes from Git revision 99f81, never from the current owner.
Pre-dev snapshots remain immutable. Only these seven functions and four
compatibility imports differ from their historical extraction contracts.
"""
import ast
import json
from pathlib import Path

REFERENCE_PATH = Path(__file__).parent / 'fixtures/approved_dev_99f81.json'
REFERENCE = json.loads(REFERENCE_PATH.read_text(encoding='utf-8'))

DEV_PORTS = {
    'curriculum_teams_meeting': ('prune_study_week_fillers', 'teams_module_session_limit'),
    'curriculum_teams_meeting_schedule': ('prune_study_week_fillers', 'teams_module_session_limit'),
    'curriculum_teams_meeting_artifacts': ('teams_module_session_limit',),
    'apply_teams_occurrence_shifts': ('read_calendar_instances',),
    'teams_expanded_instances': ('read_calendar_instances',),
}

COMPATIBILITY_IMPORTS = (
    'from curriculum_api.weekly_schedule import module_week_boundary_mode, merged_week_boundary_mode',
    'from curriculum_api.teams_calendar_checks import read_calendar_instances',
    'from curriculum_api.study_week_teams import prune_study_week_fillers',
    'from curriculum_api.meetings.infrastructure.invitation_runtime import teams_module_session_limit',
)


def reference_source(name, historical):
    source = REFERENCE['functions'].get(name, historical)
    if name == 'curriculum_teams_meeting_schedule':
        # Keep the existing architecture branch's readable punctuation. The
        # approved upstream source has U+FFFD in this one error message.
        source = source.replace(
            'That is an additional week meeting, not this module\ufffds Teams calendar.',
            'That is an additional week meeting, not this module\u2019s Teams calendar.',
        )
    return source


def restore_pre_dev_exports(tree, relative):
    """Remove only the four reviewed additions for old whole-file hashes."""
    if relative != 'views.py' or getattr(tree, '_approved_dev_exports_restored', False):
        return tree
    expected = {ast.dump(ast.parse(source).body[0]) for source in COMPATIBILITY_IMPORTS}
    present = [ast.dump(node) for node in tree.body if ast.dump(node) in expected]
    if present:
        assert len(present) == len(expected) and set(present) == expected, 'Incomplete/duplicate dev compatibility exports'
        tree.body = [node for node in tree.body if ast.dump(node) not in expected]
    tree._approved_dev_exports_restored = True
    return tree
