"""Manual plan-builder schema: DDL + tiny shared helpers.

The plan builder is the manual workspace's authoring layer: a plan is owned by
a group (cohort or a single learner treated as a group of one), organised as
relative months mapped to calendar months, holding activities with a STABLE
``activity_key`` that never changes across edits. Everything here is a
manual-owned write table — the ``setup_manual_audit`` sync must never truncate
any of it (they are registered alongside activity_overrides & co).

Identity rules (agreed in the design review):
* learners are always keyed by ``aptem_id``;
* plan activities are keyed by ``activity_key`` (uuid) — progress survives
  month moves, group moves, and plan edits because the key is stable;
* materials are soft references: ``lms:<activity_id>`` (mirror catalogue),
  ``session:<module_slug>:<YYYY-MM-DD>`` (attendance sessions),
  ``asg:<name_key>`` (assignments, aggregated by normalised component name —
  Aptem component ids are per-learner, so the per-learner resolution lives in
  ``plan_assignment_refs``), or NULL for free-hand rows;
* no foreign keys into mirror tables (the mirror is truncate+reloaded).
"""

import json
import re

from django.db import connections

from .common import CONN, db_is_read_only


# The five categories the ledger wire contract understands. Free-hand rows
# must pick one of these too, or they would not render in the existing UI.
PLAN_CATEGORIES = ("attendance", "assignment", "video", "audio", "reading+quiz")


def ensure_plan_tables(cur):
    """Create every plan-builder table (idempotent).

    Skipped entirely while the database is read-only (returns False so
    callers know the DDL did NOT run): the tables already exist in practice,
    and GET endpoints must not 503 just because their lazy DDL cannot run —
    real writes still fail loudly on their own.
    """
    if db_is_read_only(cur):
        return False
    cur.execute(
        '''
        create table if not exists "Manual_audit".manual_programmes (
            id bigint generated always as identity primary key,
            canonical_name text not null unique,
            standard_title text,
            created_by text,
            created_at timestamp with time zone not null default now()
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".manual_programme_aliases (
            programme_id bigint not null,
            alias text not null,
            primary key (programme_id, alias)
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_groups (
            id bigint generated always as identity primary key,
            name text not null,
            kind text not null default 'cohort' check (kind in ('cohort', 'individual')),
            programme_id bigint,
            programme_name text,
            aptem_group text,
            status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
            start_month text,
            created_by text,
            created_at timestamp with time zone not null default now(),
            updated_by text,
            updated_at timestamp with time zone not null default now()
        )
        '''
    )
    # Existing deployments predate the Aptem-group linkage column.
    cur.execute(
        'alter table "Manual_audit".plan_groups add column if not exists aptem_group text'
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_months (
            group_id bigint not null,
            month_index integer not null,
            calendar_month text not null,
            label text,
            anchor_date date,
            primary key (group_id, month_index)
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_activities (
            activity_key uuid primary key default gen_random_uuid(),
            group_id bigint not null,
            month_index integer not null,
            week_slot integer not null default 1,
            position integer not null default 0,
            category text not null check (category in
                ('attendance', 'assignment', 'video', 'audio', 'reading+quiz')),
            title text not null,
            subtitle text,
            material_ref text,
            planned_hours numeric not null default 0,
            planned_date date,
            included boolean not null default true,
            excluded_at timestamp with time zone,
            ksbs jsonb,
            created_by text,
            created_at timestamp with time zone not null default now(),
            updated_by text,
            updated_at timestamp with time zone not null default now()
        )
        '''
    )
    cur.execute(
        'create index if not exists plan_activities_group_month_idx '
        'on "Manual_audit".plan_activities (group_id, month_index, week_slot, position)'
    )
    # Reading+Quiz items of one week are planned as ONE row with ONE shared
    # hours figure — the bundled materials ([{ref, title}]) live here.
    cur.execute(
        'alter table "Manual_audit".plan_activities add column if not exists bundle_refs jsonb'
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_group_members (
            id bigint generated always as identity primary key,
            group_id bigint not null,
            aptem_id bigint not null,
            learner_name text,
            learner_email text,
            joined_at timestamp with time zone not null default now(),
            left_at timestamp with time zone,
            added_by text
        )
        '''
    )
    cur.execute(
        'create unique index if not exists plan_group_members_active_idx '
        'on "Manual_audit".plan_group_members (group_id, aptem_id) where left_at is null'
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_learner_progress (
            aptem_id bigint not null,
            activity_key uuid not null,
            group_id bigint,
            status text not null default 'completed' check (status in
                ('not_started', 'in_progress', 'completed', 'not_accepted')),
            completion_date date,
            actual_hours numeric,
            attendance_status text,
            quiz_attempted boolean,
            quiz_passed boolean,
            reading_viewed boolean,
            note text,
            evidence_ref text,
            suggestion_accepted boolean not null default false,
            rejected boolean not null default false,
            timestamp_from timestamp with time zone,
            timestamp_to timestamp with time zone,
            archived_at timestamp with time zone,
            updated_by text,
            updated_at timestamp with time zone not null default now(),
            primary key (aptem_id, activity_key)
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_member_dates (
            group_id bigint not null,
            aptem_id bigint not null,
            activity_key uuid not null,
            planned_date date not null,
            primary key (group_id, aptem_id, activity_key)
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_member_months (
            group_id bigint not null,
            aptem_id bigint not null,
            month_index integer not null,
            calendar_month text not null,
            anchor_date date,
            primary key (group_id, aptem_id, month_index)
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_activity_exemptions (
            activity_key uuid not null,
            aptem_id bigint not null,
            exempted_by text,
            exempted_at timestamp with time zone not null default now(),
            primary key (activity_key, aptem_id)
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_assignment_refs (
            group_id bigint not null,
            name_key text not null,
            aptem_id bigint not null,
            component_id bigint not null,
            component_name text,
            assignment_month text,
            primary key (group_id, name_key, aptem_id)
        )
        '''
    )
    cur.execute(
        '''
        create table if not exists "Manual_audit".plan_events (
            id bigint generated always as identity primary key,
            entity_type text not null,
            entity_id text not null,
            action text not null,
            old_value jsonb,
            new_value jsonb,
            actor text,
            at timestamp with time zone not null default now()
        )
        '''
    )
    return True


def log_plan_event(cur, entity_type, entity_id, action, *, old=None, new=None, actor=None):
    """Append one structural event (schedule edits, membership moves, ...)."""
    cur.execute(
        '''
        insert into "Manual_audit".plan_events
            (entity_type, entity_id, action, old_value, new_value, actor)
        values (%s, %s, %s, %s, %s, %s)
        ''',
        [
            entity_type,
            str(entity_id),
            action,
            json.dumps(old) if old is not None else None,
            json.dumps(new) if new is not None else None,
            actor,
        ],
    )


_NAME_KEY_STRIP = re.compile(r"[^a-z0-9]+")

# Cohort noise inside Aptem programme names: months, years, stages, re-runs.
# Stripping it clusters the ~34 name variants into their real programmes
# ("الطلاب اللي البروجرام نيم بتاعهم شبه بعض") so a programme's groups are the
# union of its variants' groups.
_PROGRAMME_NOISE = {
    "new", "onboarding", "stage", "v1", "1",
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept",
    "oct", "nov", "dec",
    "january", "february", "march", "april", "june", "july", "august",
    "september", "october", "november", "december",
    "pcp",
}
_PROGRAMME_SINGULAR = {"controls": "control", "managers": "manager", "executives": "executive"}


def _programme_tokens(name):
    text = re.sub(r"[^a-z0-9]+", " ", str(name or "").lower())
    tokens = []
    for tok in text.split():
        if tok in _PROGRAMME_NOISE:
            continue
        if re.fullmatch(r"(19|20)\d{2}", tok):
            continue
        if re.fullmatch(r"2[0-9]", tok):  # 2-digit cohort years ('25', '26')
            continue
        if tok in {"lv4", "lv6"}:
            tokens.extend(["level", tok[-1]])
            continue
        tokens.append(_PROGRAMME_SINGULAR.get(tok, tok))
    return tokens


def programme_key(name):
    """Cluster key: variants of the same real programme share one key."""
    return " ".join(sorted(set(_programme_tokens(name)))) or "unnamed"


def clean_programme_display(name):
    """The original name with the cohort noise removed, order preserved."""
    kept = []
    for word in re.split(r"[\s]+", str(name or "").strip()):
        bare = re.sub(r"[^a-z0-9]+", "", word.lower())
        if not bare:
            continue
        if bare in _PROGRAMME_NOISE or re.fullmatch(r"(19|20)\d{2}", bare) or re.fullmatch(r"2[0-9]", bare):
            continue
        kept.append(word.strip("-–|,"))
    return " ".join(part for part in kept if part) or str(name or "").strip()


def assignment_name_key(component_name):
    """Normalise an Aptem assignment component name into a stable key.

    Aptem component ids are unique PER LEARNER, so assignments are aggregated
    by name: trim, casefold, collapse every non-alphanumeric run to one dash
    ('AI 1:AI Foundations & Data - Assignment ' -> 'ai-1-ai-foundations-data-assignment').
    """
    collapsed = _NAME_KEY_STRIP.sub("-", str(component_name or "").strip().casefold())
    return collapsed.strip("-") or "unnamed"


def plan_cursor():
    """Cursor on the manual-audit connection (same alias the module uses)."""
    return connections[CONN].cursor()
