-- Additive catalogue bridge. Shared runtime identities and learner ledgers stay intact.
CREATE TABLE IF NOT EXISTS curriculum.free_courses (
    id varchar(128) PRIMARY KEY, course_name text NOT NULL DEFAULT '', description text,
    cover_image_url text, display_order integer NOT NULL DEFAULT 0,
    week_count integer NOT NULL DEFAULT 0, component_count integer NOT NULL DEFAULT 0,
    total_otjh numeric NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT current_timestamp,
    updated_at timestamp NOT NULL DEFAULT current_timestamp,
    course_type varchar(16) NOT NULL DEFAULT 'free' CHECK (course_type IN ('free', 'apprentices'))
);
CREATE TABLE IF NOT EXISTS curriculum.free_course_weeks (
    id varchar(128) PRIMARY KEY, course_id varchar(128) NOT NULL, week_id varchar(128),
    display_order integer NOT NULL DEFAULT 0, component_count integer NOT NULL DEFAULT 0,
    total_otjh numeric NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT current_timestamp,
    updated_at timestamp NOT NULL DEFAULT current_timestamp
);
CREATE TABLE IF NOT EXISTS curriculum.free_programme_components (
    id varchar(128) PRIMARY KEY, free_module_id varchar(128) NOT NULL, week_id varchar(128),
    programme_id varchar(255) NOT NULL, type varchar(64) NOT NULL, title text NOT NULL DEFAULT '',
    description text, expected_otjh numeric NOT NULL DEFAULT 0, points integer NOT NULL DEFAULT 0,
    reflection_required boolean NOT NULL DEFAULT false,
    workplace_evidence_required boolean NOT NULL DEFAULT false,
    tutor_validation_required boolean NOT NULL DEFAULT false,
    display_order integer NOT NULL DEFAULT 0, settings_json jsonb,
    created_at timestamp NOT NULL DEFAULT current_timestamp, updated_at timestamp NOT NULL DEFAULT current_timestamp
);
ALTER TABLE curriculum.free_courses
    ADD COLUMN IF NOT EXISTS module_catalogue_id varchar(128) UNIQUE REFERENCES curriculum.modules(module_catalogue_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS managed_by_builder boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS converted_at timestamp,
    ADD COLUMN IF NOT EXISTS deleted_at timestamp,
    ADD COLUMN IF NOT EXISTS is_for_sale boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS price numeric(10,2) CONSTRAINT free_courses_sale_price_check CHECK (
        (is_for_sale = false AND price IS NULL) OR
        (is_for_sale = true AND price IS NOT NULL AND price > 0 AND price <= 99999999.99)),
    ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP');
ALTER TABLE curriculum.free_course_weeks
    ADD COLUMN IF NOT EXISTS authoring_week_id varchar(128) UNIQUE REFERENCES curriculum.weeks(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_at timestamp,
    ADD COLUMN IF NOT EXISTS course_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS cover_image_url text,
    ADD COLUMN IF NOT EXISTS week_number integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS week_title text NOT NULL DEFAULT '';
ALTER TABLE curriculum.free_programme_components
    ADD COLUMN IF NOT EXISTS authoring_component_id varchar(128) UNIQUE REFERENCES curriculum.components(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_at timestamp;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'curriculum.free_course_weeks'::regclass
                   AND conname = 'free_course_weeks_course_fk') THEN
        ALTER TABLE curriculum.free_course_weeks ADD CONSTRAINT free_course_weeks_course_fk
            FOREIGN KEY (course_id) REFERENCES curriculum.free_courses(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'curriculum.free_programme_components'::regclass
                   AND conname = 'free_components_course_week_fk') THEN
        ALTER TABLE curriculum.free_programme_components ADD CONSTRAINT free_components_course_week_fk
            FOREIGN KEY (free_module_id) REFERENCES curriculum.free_course_weeks(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION curriculum.refresh_free_course(m curriculum.modules) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE target_id varchar(128);
BEGIN
    SELECT id INTO target_id FROM curriculum.free_courses WHERE module_catalogue_id = m.module_catalogue_id;
    IF target_id IS NULL AND m.source_type IS DISTINCT FROM 'free_course' THEN RETURN; END IF;
    IF target_id IS NULL THEN
        SELECT id INTO target_id FROM curriculum.free_courses WHERE id = m.source_id AND module_catalogue_id IS NULL;
    END IF;
    target_id := coalesce(target_id, 'FC-' || md5(m.module_catalogue_id));
    INSERT INTO curriculum.free_courses
        (id, module_catalogue_id, managed_by_builder, course_name, description, cover_image_url,
         total_otjh, is_for_sale, price, currency, deleted_at, converted_at, created_at, updated_at)
    VALUES (target_id, m.module_catalogue_id, true, m.title, m.description, m.cover_image_url,
        coalesce(m.total_otjh, 0), m.is_for_sale, m.price, m.currency, m.deleted_at,
        CASE WHEN m.source_type = 'free_course' THEN NULL ELSE current_timestamp END,
        coalesce(m.created_at, current_timestamp), coalesce(m.updated_at, current_timestamp))
    ON CONFLICT (id) DO UPDATE SET
        module_catalogue_id = excluded.module_catalogue_id, managed_by_builder = true,
        course_name = excluded.course_name, description = excluded.description,
        cover_image_url = excluded.cover_image_url, total_otjh = excluded.total_otjh,
        is_for_sale = excluded.is_for_sale, price = excluded.price, currency = excluded.currency,
        deleted_at = excluded.deleted_at, updated_at = excluded.updated_at,
        converted_at = CASE WHEN excluded.converted_at IS NULL THEN NULL
                           ELSE coalesce(free_courses.converted_at, excluded.converted_at) END;
END $$;

CREATE OR REPLACE FUNCTION curriculum.refresh_free_course_week(w curriculum.weeks) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE course curriculum.free_courses; target_id varchar(128);
BEGIN
    SELECT * INTO course FROM curriculum.free_courses WHERE module_catalogue_id = w.module_catalogue_id;
    IF course.id IS NULL THEN RETURN; END IF;
    SELECT id INTO target_id FROM curriculum.free_course_weeks WHERE authoring_week_id = w.id
        OR (authoring_week_id IS NULL AND course_id = course.id AND w.id = 'WEEK-FREE-' || upper(substr(
            encode(sha256(convert_to(course.id, 'UTF8') || decode('00', 'hex') || convert_to(id, 'UTF8')), 'hex'), 1, 32)));
    target_id := coalesce(target_id, w.id);
    INSERT INTO curriculum.free_course_weeks
        (id, course_id, week_id, authoring_week_id, course_name, week_number, week_title,
         display_order, deleted_at, created_at, updated_at)
    VALUES (target_id, course.id, w.id, w.id, course.course_name, coalesce(w.week_number, 1),
        coalesce(w.title, ''), coalesce(w.display_order, 0), w.deleted_at, w.created_at, w.updated_at)
    ON CONFLICT (id) DO UPDATE SET
        course_id = excluded.course_id, authoring_week_id = excluded.authoring_week_id,
        week_id = coalesce(free_course_weeks.week_id, excluded.week_id),
        course_name = excluded.course_name, week_number = excluded.week_number, week_title = excluded.week_title,
        display_order = excluded.display_order, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at;
    UPDATE curriculum.free_courses SET week_count = (
        SELECT count(*) FROM curriculum.weeks WHERE module_catalogue_id = w.module_catalogue_id AND deleted_at IS NULL
    ) WHERE id = course.id;
END $$;

CREATE OR REPLACE FUNCTION curriculum.refresh_free_course_component(c curriculum.components) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE owner_id varchar(128); link_id varchar(128); linked_week_id varchar(128);
        target_id varchar(128); existing_owner varchar(128);
BEGIN
    SELECT f.id, w.id, w.week_id INTO owner_id, link_id, linked_week_id FROM curriculum.free_courses f
        JOIN curriculum.free_course_weeks w ON w.course_id = f.id
        WHERE f.module_catalogue_id = c.module_catalogue_id AND w.authoring_week_id = c.week_id;
    IF owner_id IS NULL THEN RETURN; END IF;
    SELECT p.id INTO target_id FROM curriculum.free_programme_components p
        JOIN curriculum.free_course_weeks w ON w.id = p.free_module_id
        WHERE p.authoring_component_id = c.id OR (p.authoring_component_id IS NULL
            AND w.course_id = owner_id AND c.id = 'COMP-FREE-' || upper(substr(
                encode(sha256(convert_to(owner_id, 'UTF8') || decode('00', 'hex') || convert_to(p.id, 'UTF8')), 'hex'), 1, 32)));
    target_id := coalesce(target_id, c.id);
    SELECT w.course_id INTO existing_owner FROM curriculum.free_programme_components p
        JOIN curriculum.free_course_weeks w ON w.id = p.free_module_id WHERE p.id = target_id;
    IF existing_owner IS NOT NULL AND existing_owner <> owner_id THEN
        RAISE EXCEPTION 'Free component identity belongs to another course';
    END IF;
    INSERT INTO curriculum.free_programme_components
        (id, free_module_id, week_id, authoring_component_id, programme_id, type, title, description,
         expected_otjh, points, reflection_required, workplace_evidence_required, tutor_validation_required,
         display_order, settings_json, deleted_at, created_at, updated_at)
    VALUES (target_id, link_id, linked_week_id, c.id, 'FREE-COURSES', c.type, c.title, c.description,
        c.expected_otjh, c.points, c.reflection_required, c.workplace_evidence_required, c.tutor_validation_required,
        c.display_order, c.settings_json, c.deleted_at, c.created_at, c.updated_at)
    ON CONFLICT (id) DO UPDATE SET
        free_module_id = excluded.free_module_id, authoring_component_id = excluded.authoring_component_id,
        week_id = excluded.week_id,
        type = excluded.type, title = excluded.title, description = excluded.description,
        expected_otjh = excluded.expected_otjh, points = excluded.points,
        reflection_required = excluded.reflection_required, workplace_evidence_required = excluded.workplace_evidence_required,
        tutor_validation_required = excluded.tutor_validation_required, display_order = excluded.display_order,
        settings_json = excluded.settings_json, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at;
    UPDATE curriculum.free_course_weeks SET
        component_count = (SELECT count(*) FROM curriculum.components WHERE week_id = c.week_id AND deleted_at IS NULL),
        total_otjh = (SELECT coalesce(sum(expected_otjh), 0) FROM curriculum.components WHERE week_id = c.week_id AND deleted_at IS NULL)
        WHERE id = link_id;
    UPDATE curriculum.free_courses SET component_count = (
        SELECT count(*) FROM curriculum.components WHERE module_catalogue_id = c.module_catalogue_id AND deleted_at IS NULL
    ) WHERE id = owner_id;
END $$;

CREATE OR REPLACE FUNCTION curriculum.check_free_course_storage_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'free_course_weeks' THEN
        IF NEW.authoring_week_id IS NULL THEN RETURN NEW; END IF;
        IF NOT EXISTS (SELECT 1 FROM curriculum.weeks w JOIN curriculum.free_courses f
            ON f.module_catalogue_id = w.module_catalogue_id
            WHERE w.id = NEW.authoring_week_id AND f.id = NEW.course_id) THEN
            RAISE EXCEPTION 'Authored week does not belong to this free course';
        END IF;
    ELSE
        IF NEW.authoring_component_id IS NULL THEN RETURN NEW; END IF;
        IF NOT EXISTS (SELECT 1 FROM curriculum.components c JOIN curriculum.free_course_weeks w
            ON w.authoring_week_id = c.week_id JOIN curriculum.free_courses f ON f.id = w.course_id
            WHERE c.id = NEW.authoring_component_id AND w.id = NEW.free_module_id
              AND c.module_catalogue_id = f.module_catalogue_id AND NEW.week_id IS NOT DISTINCT FROM w.week_id) THEN
            RAISE EXCEPTION 'Authored component does not belong to this free course week';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION curriculum.archive_free_course_storage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'modules' THEN
        UPDATE curriculum.free_courses SET deleted_at = current_timestamp WHERE module_catalogue_id = OLD.module_catalogue_id;
    ELSIF TG_TABLE_NAME = 'weeks' THEN
        UPDATE curriculum.free_course_weeks SET deleted_at = current_timestamp WHERE authoring_week_id = OLD.id;
        UPDATE curriculum.free_courses SET week_count = (
            SELECT count(*) FROM curriculum.weeks WHERE module_catalogue_id = OLD.module_catalogue_id
            AND id <> OLD.id AND deleted_at IS NULL) WHERE module_catalogue_id = OLD.module_catalogue_id;
    ELSE
        UPDATE curriculum.free_programme_components SET deleted_at = current_timestamp WHERE authoring_component_id = OLD.id;
        UPDATE curriculum.free_course_weeks SET
            component_count = (SELECT count(*) FROM curriculum.components WHERE week_id = OLD.week_id AND id <> OLD.id AND deleted_at IS NULL),
            total_otjh = (SELECT coalesce(sum(expected_otjh), 0) FROM curriculum.components WHERE week_id = OLD.week_id AND id <> OLD.id AND deleted_at IS NULL)
            WHERE authoring_week_id = OLD.week_id;
        UPDATE curriculum.free_courses SET component_count = (
            SELECT count(*) FROM curriculum.components WHERE module_catalogue_id = OLD.module_catalogue_id
            AND id <> OLD.id AND deleted_at IS NULL) WHERE module_catalogue_id = OLD.module_catalogue_id;
    END IF;
    RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION curriculum.sync_free_course_storage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'modules' THEN PERFORM curriculum.refresh_free_course(NEW);
    ELSIF TG_TABLE_NAME = 'weeks' THEN PERFORM curriculum.refresh_free_course_week(NEW);
    ELSE
        PERFORM curriculum.refresh_free_course_component(NEW);
        IF TG_OP = 'UPDATE' AND OLD.week_id IS DISTINCT FROM NEW.week_id THEN
            UPDATE curriculum.free_course_weeks SET
                component_count = (SELECT count(*) FROM curriculum.components WHERE week_id = OLD.week_id AND deleted_at IS NULL),
                total_otjh = (SELECT coalesce(sum(expected_otjh), 0) FROM curriculum.components WHERE week_id = OLD.week_id AND deleted_at IS NULL)
                WHERE authoring_week_id = OLD.week_id;
        END IF;
    END IF;
    RETURN NEW;
END $$;

-- free_courses owns sale metadata. The existing modules columns are a compatibility
-- mirror so older deployments, revision fingerprints and conversion keep working.
-- The distinct predicate prevents recursion and avoids touching unrelated fields.
CREATE OR REPLACE FUNCTION curriculum.sync_free_course_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE curriculum.modules SET is_for_sale = NEW.is_for_sale, price = NEW.price,
        currency = NEW.currency, updated_at = current_timestamp
        WHERE module_catalogue_id = NEW.module_catalogue_id
          AND (is_for_sale, price, currency) IS DISTINCT FROM (NEW.is_for_sale, NEW.price, NEW.currency);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS free_course_storage_sync ON curriculum.modules;
CREATE TRIGGER free_course_storage_sync AFTER INSERT OR UPDATE ON curriculum.modules
    FOR EACH ROW EXECUTE FUNCTION curriculum.sync_free_course_storage();
DROP TRIGGER IF EXISTS free_course_storage_sync ON curriculum.weeks;
CREATE TRIGGER free_course_storage_sync AFTER INSERT OR UPDATE ON curriculum.weeks
    FOR EACH ROW EXECUTE FUNCTION curriculum.sync_free_course_storage();
DROP TRIGGER IF EXISTS free_course_storage_sync ON curriculum.components;
CREATE TRIGGER free_course_storage_sync AFTER INSERT OR UPDATE ON curriculum.components
    FOR EACH ROW EXECUTE FUNCTION curriculum.sync_free_course_storage();
DROP TRIGGER IF EXISTS free_course_price_sync ON curriculum.free_courses;
CREATE TRIGGER free_course_price_sync AFTER INSERT OR UPDATE OF is_for_sale, price, currency ON curriculum.free_courses
    FOR EACH ROW EXECUTE FUNCTION curriculum.sync_free_course_price();
DROP TRIGGER IF EXISTS free_course_storage_owner ON curriculum.free_course_weeks;
CREATE TRIGGER free_course_storage_owner BEFORE INSERT OR UPDATE OF course_id, authoring_week_id ON curriculum.free_course_weeks
    FOR EACH ROW EXECUTE FUNCTION curriculum.check_free_course_storage_owner();
DROP TRIGGER IF EXISTS free_course_storage_owner ON curriculum.free_programme_components;
CREATE TRIGGER free_course_storage_owner BEFORE INSERT OR UPDATE OF free_module_id, week_id, authoring_component_id ON curriculum.free_programme_components
    FOR EACH ROW EXECUTE FUNCTION curriculum.check_free_course_storage_owner();
DROP TRIGGER IF EXISTS free_course_storage_archive ON curriculum.modules;
CREATE TRIGGER free_course_storage_archive BEFORE DELETE ON curriculum.modules
    FOR EACH ROW EXECUTE FUNCTION curriculum.archive_free_course_storage();
DROP TRIGGER IF EXISTS free_course_storage_archive ON curriculum.weeks;
CREATE TRIGGER free_course_storage_archive BEFORE DELETE ON curriculum.weeks
    FOR EACH ROW EXECUTE FUNCTION curriculum.archive_free_course_storage();
DROP TRIGGER IF EXISTS free_course_storage_archive ON curriculum.components;
CREATE TRIGGER free_course_storage_archive BEFORE DELETE ON curriculum.components
    FOR EACH ROW EXECUTE FUNCTION curriculum.archive_free_course_storage();
