"""Existing SQL compatibility translation for remaining legacy consumers."""


def adapt_sql(
    sql, *, RELATION_TABLES, _ADAPTED, _CLAUSE_WORDS, _LOCKING, _NEXT_WORD, _TABLE_REF, columns_of, connection,
    legacy_read_columns, re, read_relation,
):
    """Point hand-written curriculum reads at the legacy-shaped read relation.

    Kept for the Learner team's code that curriculum calls (learner_api reads
    ``curriculum.*`` naming columns the current schema dropped: programme_name,
    deleted_at, module_ids ...). Curriculum's own statements no longer need it
    (agreed 2026-11-08); a curriculum read that is rewritten here is a defect
    to fix at its source, not a feature. Remove once learner_api reads the
    current schema.

    Only ``FROM``/``JOIN`` references to a normalised lifecycle table, and only
    when the statement names one of that table's legacy columns, are replaced;
    ``DELETE FROM`` targets, row-locking statements and every statement on the
    legacy schema pass through untouched.
    """
    if connection.vendor != 'postgresql' or not isinstance(sql, str) or 'curriculum' not in sql.lower():
        return sql
    cached = _ADAPTED.get(sql)
    if cached is not None:
        return cached
    if _LOCKING.search(sql):
        _ADAPTED[sql] = sql
        return sql
    lowered = sql.lower()

    def replace(match):
        table = (match.group('qt') or match.group('t') or '').lower()
        if table not in RELATION_TABLES:
            return match.group(0)
        if re.search(r'\bdelete\s+$', lowered[max(0, match.start() - 12):match.start()]):
            return match.group(0)
        columns = columns_of('curriculum', table)
        legacy = legacy_read_columns(table, columns)
        if not legacy or not any(re.search(rf'\b{re.escape(name)}\b', lowered) for name in legacy):
            return match.group(0)
        relation = read_relation(table, columns, alias=False)
        if not relation:
            return match.group(0)
        # Unaliased reference (``from curriculum.modules where ...``): keep the
        # table's own name addressable, as ``modules.title`` may follow.
        following = _NEXT_WORD.match(sql, match.end())
        word = (following.group(1) or '').lower() if following else ''
        if not word or word in _CLAUSE_WORDS:
            relation += f' as "{table}"'
            requalify.add(table)
        return match.group('kw') + relation

    requalify = set()
    adapted = _TABLE_REF.sub(replace, sql)
    for table in requalify:
        # The ORM names columns by schema and table ("curriculum"."modules"."title");
        # once the table is the relation aliased "modules" that reference is
        # invalid, so it is re-pointed at the alias.
        adapted = re.sub(
            rf'(?:"curriculum"|\bcurriculum)\s*\.\s*(?:"{table}"|\b{table}\b)\s*\.',
            f'"{table}".', adapted, flags=re.IGNORECASE,
        )
    _ADAPTED[sql] = adapted
    return adapted
