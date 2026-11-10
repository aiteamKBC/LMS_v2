"""Free-course pricing, stored on ``curriculum.free_courses`` and nowhere else.

Only a free course is ever for sale, on either database. On the old (production)
database a free course is also a module (``modules.source_type = 'free_course'``)
whose own row in ``free_courses`` is joined on ``free_courses.module_catalogue_id``;
its price is read and written there. ``modules`` carries no price: its
is_for_sale / price / currency columns are not on the current curriculum
database and are dropped from the old one by
``sql/2026-11-10_drop_module_pricing_columns.sql``.

On the current database free courses are rows of their own (no module behind
them); the free-course catalogue save writes their price by id
(free_course_catalogue_store).
"""
from django.db import connection

from .course_pricing import pricing_payload

FREE_COURSE_SOURCE_TYPE = 'free_course'
PRICING_COLUMNS = ('is_for_sale', 'price', 'currency')


class FreeCoursePricingUnavailable(ValueError):
    """A price was asked to be stored for a course that has nowhere to keep it."""


def is_free_course_row(row):
    return (row or {}).get('source_type') == FREE_COURSE_SOURCE_TYPE


def _linked():
    """True when free courses are joined to their module (the old database)."""
    from . import views
    columns = set(views.column_names(views.FREE_COURSES_TABLE))
    return 'module_catalogue_id' in columns and set(PRICING_COLUMNS) <= columns


def lookup(module_rows):
    """``{module_catalogue_id: {is_for_sale, price, currency}}`` for the free courses among ``module_rows``.

    One query for all of them; nothing for a list without a free course, or on
    a database where free courses are not joined to modules.
    """
    from . import views
    ids = sorted({views.clean_str(row.get('module_catalogue_id')) for row in module_rows or []
                  if is_free_course_row(row) and views.clean_str(row.get('module_catalogue_id'))})
    if not ids or not _linked():
        return {}
    rows = views.fetch_all(
        f'select module_catalogue_id, is_for_sale, price, currency '
        f'from {views.authoring_table_name(views.FREE_COURSES_TABLE)} '
        f'where module_catalogue_id in ({", ".join(["%s"] * len(ids))})',
        ids,
    )
    return {views.clean_str(row.get('module_catalogue_id')): row for row in rows}


def payload(module_row, prices):
    """The module's ``isForSale``/``price``/``currency``: its free course's, else not for sale."""
    from . import views
    if not is_free_course_row(module_row):
        return pricing_payload({})
    return pricing_payload(prices.get(views.clean_str(module_row.get('module_catalogue_id'))) or {})


def stored(module_row):
    """The stored price of one module's free course (``{}`` for any other module)."""
    from . import views
    return lookup([module_row]).get(views.clean_str((module_row or {}).get('module_catalogue_id'))) or {}


def save(module_catalogue_id, values):
    """Store ``values`` (course_pricing.pricing_values output) on the module's free course.

    Call inside the transaction that saved the module: on the old database the
    module write itself creates or refreshes the free course row this updates.
    A course that is not for sale and has nowhere to keep a price is left
    alone; one that is for sale raises FreeCoursePricingUnavailable, so the
    save fails instead of dropping the price.
    """
    from . import views
    updated = 0
    if _linked():
        with connection.cursor() as cursor:
            cursor.execute(
                f'update {views.authoring_table_name(views.FREE_COURSES_TABLE)} '
                f'set is_for_sale = %s, price = %s, currency = %s, updated_at = current_timestamp '
                f'where module_catalogue_id = %s',
                [values['is_for_sale'], values['price'], values['currency'], module_catalogue_id],
            )
            updated = cursor.rowcount
    if not updated and values.get('is_for_sale'):
        raise FreeCoursePricingUnavailable(
            'isForSale', 'This free course has no catalogue record to keep its price yet. Save it once, then set the price.')
    return updated
