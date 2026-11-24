"""Existing programme audit asset constants; public names are re-exported unchanged."""

PROGRAMME_AUDIT_SCHEMA = 'programme_audit'

PROGRAMME_AUDIT_TABLE = 'assets'

UPLOAD_URL_PREFIX = '/curriculum_api/curriculum/uploads/'

JSON_COLUMNS = {'ksb_mappings', 'settings', 'raw_component', 'raw_payload'}

UI_MATERIAL_TABLES = {
    'impact-planning': {'table': 'impact_planning', 'name': 'Impact Planning', 'programme': 'ME'},
    'social-media': {'table': 'social_media', 'name': 'Social Media', 'programme': 'ME'},
    'marketing-technology': {'table': 'marketing_technology', 'name': 'Marketing Technology', 'programme': 'ME'},
    'strategy-planning': {'table': 'strategy_planning', 'name': 'Strategy Planning', 'programme': 'MM'},
    'customer-journey': {'table': 'customer_journey', 'name': 'Customer Journey', 'programme': 'MM'},
    'commercial-intelligence': {'table': 'commercial_intelligence', 'name': 'Commercial Intelligence', 'programme': 'MM'},
    'ai-in-marketing': {'table': 'ai_in_marketing', 'name': 'AI in Marketing', 'programme': 'MM'},
    'project-management-professional': {'table': 'project_management_professional', 'name': 'Project Management Professional', 'programme': 'PCP'},
    'msp-scheduling-professional': {'table': 'managing_successful_programmes_scheduling_professional', 'name': 'Managing Successful Programmes / Scheduling Professional', 'programme': 'PCP'},
    'risk-management': {'table': 'risk_management', 'name': 'Risk Management', 'programme': 'PCP'},
    'evm-portfolio-management': {'table': 'earned_value_management_portfolio_management', 'name': 'Earned Value Management / Portfolio Management', 'programme': 'PCP'},
    'ppc-pmo': {'table': 'project_planning_control_project_management_office', 'name': 'Project Planning Control / Project Management Office', 'programme': 'PCP'},
}

ASSET_COLUMNS = (
    'id',
    'programme_id',
    'programme_source_id',
    'programme_name',
    'module_catalogue_id',
    'module_title',
    'week_id',
    'week_number',
    'week_title',
    'component_id',
    'component_type',
    'content_kind',
    'title',
    'description',
    'source_url',
    'embed_url',
    'embed_code',
    'render_mode',
    'file_name',
    'content_type',
    'file_size',
    'duration_minutes',
    'expected_otjh',
    'points',
    'status',
    'ksb_mappings',
    'settings',
    'raw_component',
    'raw_payload',
    'imported_from',
    'source_key',
    'imported_at',
    'updated_at',
)

KBC_WORDPRESS_SCHEMA_URL = 'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/all-students-schema'

