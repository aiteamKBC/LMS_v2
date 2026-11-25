"""Canonical template KSB reads and writes for catalogue composition."""
from django.db import connection
from curriculum_api import template_ksbs


def read_template_mapping_revision(template_id):
    with connection.cursor() as cursor:
        cursor.execute('''SELECT m.id,m.template_component_id,m.standard_ksb_id,m.classification,
                m.weight,m.weight_class,m.status
            FROM curriculum.ksb_component_mappings m
            JOIN curriculum.week_template_components c ON c.id=m.template_component_id
            WHERE c.week_template_id=%s ORDER BY m.id''', [template_id])
        return cursor.fetchall()


def occupied_template_component_ids(identifiers):
    if not identifiers:
        return set()
    with connection.cursor() as cursor:
        cursor.execute('SELECT id FROM curriculum.week_template_components WHERE id=ANY(%s)', [identifiers])
        return {row[0] for row in cursor.fetchall()}


def replace_template_mappings(component_id, mappings):
    with connection.cursor() as cursor:
        template_ksbs.replace(cursor, component_id, mappings)


def delete_template_components(template_id, identifiers):
    if not identifiers:
        return
    with connection.cursor() as cursor:
        cursor.execute('DELETE FROM curriculum.ksb_component_mappings WHERE template_component_id=ANY(%s)', [identifiers])
        cursor.execute('DELETE FROM curriculum.week_template_components WHERE week_template_id=%s AND id=ANY(%s)', [template_id, identifiers])


def attach_template_mappings(rows):
    identifiers = [row['id'] for row in rows]
    if not identifiers:
        return rows
    with connection.cursor() as cursor:
        cursor.execute('SELECT id,week_template_id FROM curriculum.week_template_components '
                       'WHERE week_template_id=ANY(%s) ORDER BY display_order,id', [identifiers])
        owners = cursor.fetchall()
        mappings = template_ksbs.items(cursor, [owner[0] for owner in owners])
    grouped = {}
    for component_id, template_id in owners:
        grouped.setdefault(template_id, []).extend(mappings.get(component_id, []))
    return [{**row, 'ksb_mappings': grouped.get(row['id'], [])} for row in rows]
