"""Final notification schema; request-time verification never repairs data."""

COLUMNS = {'id', 'tutor_id', 'module_catalogue_id', 'status', 'attempts',
           'detail', 'created_at', 'updated_at'}


def create_table(cursor, vendor):
    prefix = 'curriculum.' if vendor == 'postgresql' else ''
    identity = 'uuid DEFAULT gen_random_uuid()' if vendor == 'postgresql' else (
        "text DEFAULT (lower(hex(randomblob(16))))")
    cursor.execute(f'''CREATE TABLE IF NOT EXISTS {prefix}tutor_module_notifications (
        id {identity} PRIMARY KEY,
        tutor_id varchar(128) NOT NULL REFERENCES {prefix}tutors(id) ON DELETE RESTRICT,
        module_catalogue_id varchar(128) NOT NULL
            REFERENCES {prefix}modules(module_catalogue_id) ON DELETE RESTRICT,
        status varchar(32) NOT NULL DEFAULT 'sent',
        attempts integer NOT NULL DEFAULT 0,
        detail text NOT NULL DEFAULT '',
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tutor_id, module_catalogue_id)
    )''')


def verify(cursor, vendor):
    prefix = 'curriculum.' if vendor == 'postgresql' else ''
    cursor.execute(f'SELECT * FROM {prefix}tutor_module_notifications WHERE 1=0')
    if {col[0] for col in cursor.description} != COLUMNS:
        raise RuntimeError('Tutor notification schema is not normalized; apply migration 0100.')
    if vendor != 'postgresql':
        return
    cursor.execute("""SELECT data_type,column_default FROM information_schema.columns
        WHERE table_schema='curriculum' AND table_name='tutor_module_notifications'
        AND column_name='id'""")
    kind, default = cursor.fetchone()
    cursor.execute("""SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid='curriculum.tutor_module_notifications'::regclass
        AND contype IN ('p','u','f') AND convalidated""")
    definitions = {row[0] for row in cursor.fetchall()}
    required = {'PRIMARY KEY (id)', 'UNIQUE (tutor_id, module_catalogue_id)',
        'FOREIGN KEY (tutor_id) REFERENCES curriculum.tutors(id) ON DELETE RESTRICT',
        'FOREIGN KEY (module_catalogue_id) REFERENCES curriculum.modules(module_catalogue_id) ON DELETE RESTRICT'}
    if kind != 'uuid' or 'gen_random_uuid()' not in (default or '') or not required <= definitions:
        raise RuntimeError('Tutor notification UUID/relationship constraints do not match migration 0100.')
