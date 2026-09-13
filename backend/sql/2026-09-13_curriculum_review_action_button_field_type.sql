-- Adds the 'action_button' field type (e.g. a "Take snapshot" button placed
-- inside a Review's Form Builder section) to the review_fields.field_type
-- CHECK constraint. Run against Neon directly -- see backend/sql conventions.
BEGIN;

ALTER TABLE curriculum.review_fields DROP CONSTRAINT IF EXISTS review_fields_field_type_valid;

ALTER TABLE curriculum.review_fields ADD CONSTRAINT review_fields_field_type_valid CHECK (field_type IN (
    'text', 'boolean', 'numeric', 'date', 'list_item', 'boolean_case_block',
    'email', 'phone', 'postcode_address', 'title_description', 'text_multiline',
    'action_button'
));

COMMIT;
