"""One durable write in New era, separate from its rebuildable session caches."""
from contextlib import contextmanager
from hashlib import sha256
import json
import uuid


class ReviewConflict(Exception):
    pass


class ReviewUnavailable(Exception):
    pass


def digest(value):
    return sha256(json.dumps(value, sort_keys=True, default=str, separators=(',', ':')).encode()).hexdigest()


@contextmanager
def connect(*, write=False):
    from .recordings_saved_evidence import source_dsn
    import psycopg
    from psycopg.rows import dict_row
    dsn = source_dsn()
    if not dsn:
        raise ReviewUnavailable('The quality review store is not configured.')
    try:
        with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=3,
             options='-c default_transaction_read_only=' + ('off' if write else 'on')) as connection:
            connection.execute("SET LOCAL statement_timeout='5000ms'")
            connection.execute("SET LOCAL lock_timeout='2000ms'")
            yield connection
    except psycopg.Error:
        # Never return DSNs, SQL parameters or user evidence in an exception.
        raise ReviewUnavailable('Quality reviews could not be saved or loaded. Please retry.') from None


def _payload(row):
    if not row:
        return None
    value = row['payload']
    return json.loads(value) if isinstance(value, str) else value


def read_review(identity=None, review_id=None):
    with connect() as connection:
        return _payload(connection.execute('SELECT payload FROM lms_quality.review WHERE ' +
          ('identity=%s' if identity else 'id=%s'), [identity or review_id]).fetchone())


def save_review(snapshot, *, expected, request_id, actor):
    from psycopg.types.json import Jsonb
    request_hash = digest([snapshot, expected, actor])
    with connect(write=True) as connection:
        # Existing retries return their exact saved revision, never another
        # user's result or a newly overwritten version.
        replay = connection.execute('SELECT request_hash,actor,payload FROM lms_quality.revision WHERE request_id=%s', [request_id]).fetchone()
        if replay:
            if replay['request_hash'] != request_hash or replay['actor'] != actor:
                raise ReviewConflict('This save identifier has already been used for a different change.')
            return _payload(replay)
        current = connection.execute('SELECT id,version,payload FROM lms_quality.review WHERE identity=%s', [snapshot['identity']]).fetchone()
        if current and current['version'] != expected or not current and expected != 0:
            raise ReviewConflict('This review changed in another window. Reload the saved version before saving again.')
        review_id = str(current['id']) if current else str(uuid.uuid4())
        image_ids = [identity for values in snapshot['form']['images'].values() for identity in values]
        if image_ids:
            images = connection.execute('SELECT id,section FROM lms_quality.image WHERE review_id=%s AND id=ANY(%s::uuid[])', [review_id,image_ids]).fetchall()
            allowed = {(str(row['id']),row['section']) for row in images}
            if any((identity,section) not in allowed for section,values in snapshot['form']['images'].items() for identity in values):
                raise ReviewConflict('A screenshot does not belong to this review and section.')
        from datetime import datetime, timezone
        saved = {**snapshot, 'id':review_id, 'version':expected+1,
                 'updatedBy':actor, 'updatedAt':datetime.now(timezone.utc).isoformat()}
        params = [saved['coach']['email'],saved['learner']['id'],saved['learner']['name'],
                  saved['meeting']['startsAt'],saved['meeting']['endsAt'],saved['status'],saved['version'],Jsonb(saved),actor]
        if current:
            result = connection.execute('''UPDATE lms_quality.review SET coach_email=%s,learner_id=%s,learner_name=%s,
              starts_at=%s,ends_at=%s,status=%s,version=%s,payload=%s,updated_by=%s,updated_at=CURRENT_TIMESTAMP
              WHERE id=%s AND version=%s''', [*params,review_id,expected])
            if result.rowcount != 1:
                raise ReviewConflict('This review changed while saving. Reload the saved version.')
        else:
            result = connection.execute('''INSERT INTO lms_quality.review
              (coach_email,learner_id,learner_name,starts_at,ends_at,status,version,payload,updated_by,id,identity)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(identity) DO NOTHING''', [*params,review_id,saved['identity']])
            if result.rowcount != 1:
                raise ReviewConflict('Another reviewer just created this review. Reload its saved version.')
        connection.execute('''INSERT INTO lms_quality.revision (review_id,version,request_id,request_hash,actor,payload)
          VALUES (%s,%s,%s,%s,%s,%s)''', [review_id,saved['version'],request_id,request_hash,actor,Jsonb(saved)])
        return saved


def list_reviews(start,end,coach='',status='',offset=0,search='',review_type='',pdf=''):
    from .quality_review_types import type_sql
    where = 'starts_at >= %s AND starts_at < %s'
    params = [start,end]
    if coach:
        where += ' AND coach_email=%s'
        params.append(coach)
    if status:
        where += ' AND status=%s'
        params.append(status)
    if review_type:
        where += ' AND (' + type_sql() + ')=%s'
        params.append(review_type)
    if pdf:
        where += ' AND ' + ('NOT ' if pdf == 'missing' else '') + 'EXISTS (SELECT 1 FROM lms_quality.document d WHERE d.review_id=lms_quality.review.id)'
    if search:
        where += " AND (learner_name ILIKE %s ESCAPE '!' OR payload->'meeting'->>'title' ILIKE %s ESCAPE '!')"
        term='%'+search.replace('!','!!').replace('%','!%').replace('_','!_')+'%'
        params.extend([term,term])
    with connect() as connection:
        rows = connection.execute('''SELECT id,coach_email,learner_id,learner_name,starts_at,status,version,updated_at,
          payload->'meeting'->>'title' AS title,payload->'coach'->>'name' AS coach_name,
          jsonb_array_length(payload->'form'->'actions') AS action_count,'''+type_sql()+''' AS review_type,
          (SELECT max(d.version) FROM lms_quality.document d WHERE d.review_id=lms_quality.review.id) AS pdf_version
          FROM lms_quality.review WHERE ''' + where + ' ORDER BY starts_at DESC,id LIMIT 31 OFFSET %s', [*params,offset]).fetchall()
    return rows[:30], offset+30 if len(rows)>30 else None


def save_image(review_id, section, filename, content):
    value_hash = sha256(content).hexdigest()
    with connect(write=True) as connection:
        # Review lock only covers the small image write, never external I/O.
        if not connection.execute('SELECT id FROM lms_quality.review WHERE id=%s FOR UPDATE', [review_id]).fetchone():
            raise ReviewConflict('Save the draft before attaching screenshots.')
        existing = connection.execute('SELECT id FROM lms_quality.image WHERE review_id=%s AND section=%s AND digest=%s', [review_id,section,value_hash]).fetchone()
        if existing:
            return str(existing['id'])
        count = connection.execute('SELECT count(*) AS total FROM lms_quality.image WHERE review_id=%s', [review_id]).fetchone()['total']
        if count >= 20:
            raise ReviewConflict('The screenshot limit for this review has been reached.')
        identity = str(uuid.uuid4())
        connection.execute('INSERT INTO lms_quality.image (id,review_id,section,digest,filename,content) VALUES (%s,%s,%s,%s,%s,%s)',
                           [identity,review_id,section,value_hash,filename,content])
        return identity


def read_image(review_id, image_id):
    with connect() as connection:
        return connection.execute('SELECT filename,content FROM lms_quality.image WHERE review_id=%s AND id=%s', [review_id,image_id]).fetchone()


def read_images(review_id, sections):
    identities=[identity for values in sections.values() for identity in values]
    if not identities:
        return {}
    with connect() as connection:
        rows=connection.execute('SELECT id,section,content FROM lms_quality.image WHERE review_id=%s AND id=ANY(%s::uuid[])',
          [review_id,identities]).fetchall()
    images={str(row['id']):row for row in rows}
    if any(identity not in images or images[identity]['section']!=section for section,values in sections.items() for identity in values):
        raise ReviewConflict('A saved screenshot is unavailable for this review version. Please retry.')
    return images


def _template_state(connection, kind=''):
    from .quality_form_definition import initial_state
    key=initial_state(kind)['id']
    row=connection.execute('SELECT payload FROM lms_quality.form_template WHERE id=%s',[key]).fetchone()
    if row:
        return _payload(row)
    inherited=None
    if kind:
        inherited=_payload(connection.execute('SELECT payload FROM lms_quality.form_template WHERE id=%s',[initial_state()['id']]).fetchone())
    return initial_state(kind,inherited)


def read_template(kind=''):
    with connect() as connection:
        return _template_state(connection,kind)


def save_template(definition, *, expected, request_id, actor, publish=False):
    from datetime import datetime, timezone
    from copy import deepcopy
    from psycopg.types.json import Jsonb
    from .quality_form_definition import initial_state
    key=definition['id']
    request_hash=digest([definition,expected,actor,publish])
    with connect(write=True) as connection:
        replay=connection.execute('SELECT request_hash,actor,payload FROM lms_quality.form_revision WHERE request_id=%s',[request_id]).fetchone()
        if replay:
            if replay['request_hash']!=request_hash or replay['actor']!=actor:
                raise ReviewConflict('This form save identifier was used for another change.')
            return _payload(replay)
        row=connection.execute('SELECT payload FROM lms_quality.form_template WHERE id=%s',[key]).fetchone()
        current=_payload(row) or _template_state(connection,definition.get('reviewType',''))
        if current['revision']!=expected:
            raise ReviewConflict('The form changed in another window. Reload it before saving.')
        stamp=datetime.now(timezone.utc).isoformat()
        saved={**current,'revision':expected+1,'draft':deepcopy(definition),'updatedAt':stamp,'updatedBy':actor}
        if publish:
            saved['published']={**deepcopy(definition),'version':current['published']['version']+1}
            saved['publishedAt']=stamp
        if row:
            result=connection.execute('''UPDATE lms_quality.form_template SET revision=%s,payload=%s,updated_at=CURRENT_TIMESTAMP
              WHERE id=%s AND revision=%s''',[expected+1,Jsonb(saved),key,expected])
        else:
            result=connection.execute('''INSERT INTO lms_quality.form_template(id,revision,payload)
              VALUES (%s,%s,%s) ON CONFLICT(id) DO NOTHING''',[key,expected+1,Jsonb(saved)])
        if result.rowcount!=1:
            raise ReviewConflict('Another editor saved this form. Reload the saved definition.')
        connection.execute('''INSERT INTO lms_quality.form_revision(template_id,revision,request_id,request_hash,actor,payload)
          VALUES (%s,%s,%s,%s,%s,%s)''',[key,expected+1,request_id,request_hash,actor,Jsonb(saved)])
        return saved


def read_revision(review_id, version):
    with connect() as connection:
        return _payload(connection.execute('SELECT payload FROM lms_quality.revision WHERE review_id=%s AND version=%s',
                                           [review_id,version]).fetchone())


def read_document(review_id, version):
    with connect() as connection:
        return connection.execute('SELECT filename,digest,content FROM lms_quality.document WHERE review_id=%s AND version=%s',
                                  [review_id,version]).fetchone()


def save_document(review, content):
    if not content.startswith(b'%PDF-') or len(content)>20*1024*1024:
        raise ReviewUnavailable('The generated quality PDF is invalid or too large.')
    filename=f'quality-check-{review["id"]}-v{review["version"]}.pdf'
    value_hash=sha256(content).hexdigest()
    with connect(write=True) as connection:
        # The immutable saved revision must already exist. Duplicate concurrent
        # PDF preparation keeps the first saved bytes for this version.
        row=connection.execute('SELECT payload FROM lms_quality.revision WHERE review_id=%s AND version=%s',
                               [review['id'],review['version']]).fetchone()
        snapshot=_payload(row)
        if not snapshot or snapshot['status']!='completed' or digest(snapshot)!=digest(review):
            raise ReviewConflict('The PDF does not match a completed saved review version.')
        connection.execute('''INSERT INTO lms_quality.document(review_id,version,filename,digest,content)
          VALUES (%s,%s,%s,%s,%s) ON CONFLICT(review_id,version) DO NOTHING''',
          [review['id'],review['version'],filename,value_hash,content])
        return connection.execute('SELECT filename,digest,content FROM lms_quality.document WHERE review_id=%s AND version=%s',
                                  [review['id'],review['version']]).fetchone()


def reviews_for_meeting(identity, offset=0):
    from .quality_review_types import type_sql
    with connect() as connection:
        rows=connection.execute('''SELECT r.id,r.learner_id,r.learner_name,r.status,r.version,r.updated_at,'''+type_sql('r')+''' AS review_type,
          (SELECT max(d.version) FROM lms_quality.document d WHERE d.review_id=r.id) AS pdf_version
          FROM lms_quality.review r WHERE r.payload->'meeting'->>'id'=%s
          ORDER BY r.learner_name,r.id LIMIT 31 OFFSET %s''',[identity,offset]).fetchall()
    return rows[:30],offset+30 if len(rows)>30 else None
