"""Create programme-audit tables using the material names shown in learner UI."""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from curriculum_api import programme_audit
from curriculum_api import views as curriculum_views
from curriculum_api.ai_marketing_curriculum import sync_projection as sync_ai_marketing_projection


# Kept in sync with frontend/src/lib/demoProgrammeMaterials.ts. These are the
# learner-facing groups, not the longer authored curriculum module titles.
UI_MATERIALS = (
    {'key': 'impact-planning', 'name': 'Impact Planning', 'programme_id': 'ME', 'programme_name': 'Marketing Executive', 'module_ids': ('MOD-202608228DDFCB53074A',)},
    {'key': 'social-media', 'name': 'Social Media', 'programme_id': 'ME', 'programme_name': 'Marketing Executive', 'module_ids': ('MOD-2026082243BD5ED0A8EA',)},
    {'key': 'marketing-technology', 'name': 'Marketing Technology', 'programme_id': 'ME', 'programme_name': 'Marketing Executive', 'module_ids': ('MOD-2026082273BF1B44335F',)},
    {'key': 'strategy-planning', 'name': 'Strategy Planning', 'programme_id': 'MM', 'programme_name': 'Marketing Manager', 'module_ids': ('MOD-202608223E23693425BC',)},
    {'key': 'customer-journey', 'name': 'Customer Journey', 'programme_id': 'MM', 'programme_name': 'Marketing Manager', 'module_ids': ('MOD-20260822222D7B9190AA',)},
    {'key': 'commercial-intelligence', 'name': 'Commercial Intelligence', 'programme_id': 'MM', 'programme_name': 'Marketing Manager', 'module_ids': ('MOD-20260822BFA56444DE10',)},
    {'key': 'ai-in-marketing', 'name': 'AI in Marketing', 'programme_id': 'MM', 'programme_name': 'Marketing Manager', 'module_ids': (), 'lms_programme_ids': ('125593',)},
    {'key': 'project-management-professional', 'name': 'Project Management Professional', 'programme_id': 'PCP', 'programme_name': 'Project Controls Professional', 'module_ids': ('MOD-2026082245779A87FE0C',)},
    {'key': 'msp-scheduling-professional', 'name': 'Managing Successful Programmes / Scheduling Professional', 'programme_id': 'PCP', 'programme_name': 'Project Controls Professional', 'module_ids': ('MOD-20260822B2177D2C4599', 'MOD-202608223894BBCBCF5F')},
    {'key': 'risk-management', 'name': 'Risk Management', 'programme_id': 'PCP', 'programme_name': 'Project Controls Professional', 'module_ids': ('MOD-202608227739EC14E0CC',)},
    {'key': 'evm-portfolio-management', 'name': 'Earned Value Management / Portfolio Management', 'programme_id': 'PCP', 'programme_name': 'Project Controls Professional', 'module_ids': ('MOD-202608226F0A69EDAD30', 'MOD-20260822007072C8A616')},
    {'key': 'ppc-pmo', 'name': 'Project Planning Control / Project Management Office', 'programme_id': 'PCP', 'programme_name': 'Project Controls Professional', 'module_ids': ('MOD-2026082281333774FD28', 'MOD-20260822C8C4CF8F9D6F')},
)

LEGACY_TABLES = (
    'july_2025_level_4_marketing_executive',
    'level_4_marketing_executive_may_25',
    'level_6_project_controls_professional_oct_25',
    'level_6_project_controls_professional_pcp_may_25',
    'marketing_executive_level_4_feb_2026',
    'marketing_manager_level_6_feb_2026',
    'new_level_6_marketing_manager_oct_25',
    'new_level_6_project_controls_professional_pcp_july_25',
    'project_controls_professional_level_6_feb_2026',
    'marketing_executive_l4_ksbs',
    'marketing_executive_level_4_mct_prep',
    'marketing_impact_and_planning_marketing_executive_apprenticeshi',
    'marketing_manager_level_6_ksbs',
    'project_controls_professional_l6_ksbs',
    'ray_project_management_professional_apprenticeship_pcp',
    'ray_project_management_professional_apprenticeship_pcp_july',
)


class Command(BaseCommand):
    help = 'Create canonical programme-audit tables named after learner-facing UI materials.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Create/refresh UI material tables. Default is dry-run.')
        parser.add_argument(
            '--material',
            action='append',
            dest='materials',
            help='Material key to refresh; repeat for multiple. Default refreshes every material.',
        )
        parser.add_argument(
            '--replace-legacy-tables',
            action='store_true',
            help='After all UI tables verify, drop the obsolete per-cohort/source tables.',
        )

    def handle(self, *args, **options):
        requested = set(options['materials'] or ())
        materials = [material for material in UI_MATERIALS if not requested or material['key'] in requested]
        missing_keys = requested - {material['key'] for material in materials}
        if missing_keys:
            raise CommandError('Unknown UI material key(s): ' + ', '.join(sorted(missing_keys)))
        groups = []
        for material in materials:
            assets = []
            for module_id in material['module_ids']:
                payload = curriculum_views.get_authoring_structure_payload(module_id)
                if not payload:
                    raise CommandError(f'Authored module not found: {module_id} ({material["name"]}).')
                module_assets = programme_audit.assets_from_payload(
                    payload,
                    imported_from=f'curriculum-ui-material:{material["key"]}',
                )
                if not module_assets:
                    raise CommandError(f'Authored module has no assets: {module_id} ({material["name"]}).')
                assets.extend(module_assets)
            lms_programme_ids = material.get('lms_programme_ids', ())
            if lms_programme_ids:
                lms_assets = self.fetch_lms_assets(lms_programme_ids)
                if not lms_assets:
                    raise CommandError(
                        f'LMS programme(s) {", ".join(lms_programme_ids)} have no audit assets '
                        f'for {material["name"]}.'
                    )
                assets.extend(lms_assets)
            assets = programme_audit.scope_assets_to_ui_material(material, assets)
            groups.append({'material': material, 'assets': assets})
            table = programme_audit.per_programme_table_ident(material['name'], material['key'])
            self.stdout.write(
                f'  {table}: {len(assets)} rows <- {material["name"]} '
                f'({len(material["module_ids"])} authored module(s), '
                f'{len(lms_programme_ids)} LMS group(s))'
            )

        legacy = self.existing_legacy_tables()
        if legacy:
            self.stdout.write(f'  legacy tables to replace: {len(legacy)}')
        if not options['apply']:
            self.stdout.write(self.style.WARNING(
                f'DRY RUN: {len(groups)} UI material tables; pass --apply to write them.'
            ))
            return

        try:
            for group in groups:
                self.replace_material_table(group['material'], group['assets'])
                self.verify_material_table(group['material'], len(group['assets']))
                if group['material']['key'] == 'ai-in-marketing':
                    sync_ai_marketing_projection()
                self.stdout.write(f'  verified {group["material"]["name"]}')
            if options['replace_legacy_tables']:
                self.drop_legacy_tables(legacy)
        except Exception as exc:  # noqa: BLE001
            raise CommandError(str(exc)) from exc

        total = sum(len(group['assets']) for group in groups)
        suffix = f'; replaced {len(legacy)} legacy tables' if options['replace_legacy_tables'] else '; legacy tables preserved'
        self.stdout.write(self.style.SUCCESS(
            f'COMMITTED: {total} rows split into {len(groups)} UI material tables{suffix}.'
        ))

    @staticmethod
    def existing_legacy_tables():
        if connection.vendor != 'postgresql':
            return []
        with connection.cursor() as cursor:
            cursor.execute(
                '''SELECT table_name FROM information_schema.tables
                   WHERE table_schema = %s AND table_name = ANY(%s)
                   ORDER BY table_name''',
                [programme_audit.PROGRAMME_AUDIT_SCHEMA, list(LEGACY_TABLES)],
            )
            return [row[0] for row in cursor.fetchall()]

    @staticmethod
    def fetch_lms_assets(programme_ids):
        programme_audit.require_programme_audit_table()
        placeholders = ', '.join(['%s'] * len(programme_ids))
        columns = ', '.join(
            programme_audit.quote_ident(column) for column in programme_audit.ASSET_COLUMNS
        )
        with connection.cursor() as cursor:
            cursor.execute(
                f'''SELECT {columns} FROM {programme_audit.asset_table_name()}
                    WHERE programme_id IN ({placeholders})''',
                list(programme_ids),
            )
            return [
                programme_audit.serialise_asset_row(row)
                for row in programme_audit.rows_as_dicts(cursor)
            ]

    @staticmethod
    def replace_material_table(material, assets):
        table = programme_audit.per_programme_table_name(material['name'], material['key'])
        row_placeholders = [
            '%s::jsonb' if connection.vendor == 'postgresql' and column in programme_audit.JSON_COLUMNS else '%s'
            for column in programme_audit.ASSET_COLUMNS
        ]
        columns = ', '.join(programme_audit.quote_ident(column) for column in programme_audit.ASSET_COLUMNS)
        with transaction.atomic():
            programme_audit.provision_per_programme_table(material['name'], material['key'])
            with connection.cursor() as cursor:
                cursor.execute(f'DELETE FROM {table}')
                for offset in range(0, len(assets), 100):
                    chunk = assets[offset:offset + 100]
                    values_sql = ', '.join(
                        f'({", ".join(row_placeholders)})' for _asset in chunk
                    )
                    params = [
                        value
                        for asset in chunk
                        for value in programme_audit.db_params(asset)
                    ]
                    cursor.execute(
                        f'INSERT INTO {table} ({columns}) VALUES {values_sql}',
                        params,
                    )

    @staticmethod
    def verify_material_table(material, expected_count):
        table = programme_audit.per_programme_table_name(material['name'], material['key'])
        with connection.cursor() as cursor:
            cursor.execute(
                f'''SELECT count(*), count(DISTINCT module_title), min(module_title),
                           array_agg(DISTINCT module_catalogue_id ORDER BY module_catalogue_id)
                    FROM {table}'''
            )
            count, title_count, title, module_ids = cursor.fetchone()
        if expected_count == 0:
            if count != 0:
                raise RuntimeError(f'Verification failed for empty material table {table}.')
            return
        if (
            count != expected_count
            or title_count != 1
            or title != material['name']
            or (
                material['module_ids']
                and tuple(module_ids or ()) != tuple(sorted(material['module_ids']))
            )
        ):
            raise RuntimeError(f'Verification failed for {table}.')

    @staticmethod
    def drop_legacy_tables(tables):
        if not tables:
            return
        with transaction.atomic():
            with connection.cursor() as cursor:
                for table in tables:
                    cursor.execute(
                        f'DROP TABLE {programme_audit.quote_ident(programme_audit.PROGRAMME_AUDIT_SCHEMA)}.'
                        f'{programme_audit.quote_ident(table)}'
                    )
