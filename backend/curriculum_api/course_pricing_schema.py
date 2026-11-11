"""Additive pricing schema shared by migration 0079 and isolated test setup.

Keep this definition stable; runtime requests never provision this schema.
"""


def provision(connection):
    table = 'curriculum.modules' if connection.vendor == 'postgresql' else 'modules'
    definitions = (
        ('is_for_sale', 'boolean NOT NULL DEFAULT false'),
        ('price', '''numeric(10,2) CONSTRAINT curriculum_modules_sale_price_check CHECK (
            (is_for_sale = false AND price IS NULL) OR
            (is_for_sale = true AND price IS NOT NULL AND price > 0 AND price <= 99999999.99)
        )'''),
        ('currency', "varchar(3) NOT NULL DEFAULT 'GBP' CHECK (currency = 'GBP')"),
    )
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            for name, definition in definitions:
                cursor.execute(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {definition}')
        else:
            cursor.execute('PRAGMA table_info(modules)')
            columns = {row[1] for row in cursor.fetchall()}
            if not columns:
                return
            for name, definition in definitions:
                if name not in columns:
                    cursor.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')
