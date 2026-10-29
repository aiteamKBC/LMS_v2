"""Parts of one verified occurrence, never every use of a recurring join link."""
from .recordings_media import in_session_window
from .recordings_calendar import _instant


def occurrence_parts(rows, window, *, anchors=()):
    """Include overlapping parts and continuations with the same physical call ID.

    Call identity must be anchored by a timed artifact in this occurrence. A
    recurring onlineMeeting ID alone is deliberately insufficient.
    """
    window=tuple(_instant(value) for value in window)
    if len(window)!=2 or not all(window) or window[1]<=window[0]:
        raise ValueError('Invalid occurrence interval.')
    rows=list(rows)
    # A continuation can introduce another correlation/call identity for its
    # next part. Follow that verified chain to closure, independently of provider
    # page order. A reused onlineMeeting/join URL never supplies an anchor.
    valid=[row for row in [*anchors,*rows] if row.get('id')
        and (first:=_instant(row.get('createdDateTime'))) is not None
        and (last:=_instant(row.get('endDateTime'))) is not None and last>first]
    links={}; pending=[]
    for index,row in enumerate(valid):
        for field in ('callId','contentCorrelationId'):
            if row.get(field):
                links.setdefault((field,row[field]),[]).append(index)
        if in_session_window(row['createdDateTime'],row['endDateTime'],window) is True:
            pending.append(index)
    visited=set(); identities=set()
    while pending:
        index=pending.pop()
        if index in visited:
            continue
        visited.add(index)
        for field in ('callId','contentCorrelationId'):
            if valid[index].get(field):
                identity=(field,valid[index][field])
                if identity not in identities:
                    identities.add(identity)
                    pending.extend(links.get(identity,[]))
    found={}; seen=set()
    for row in rows:
        first,last=_instant(row.get('createdDateTime')),_instant(row.get('endDateTime'))
        if not row.get('id') or not first or not last or last<=first:
            continue
        linked=any((field,row.get(field)) in identities for field in ('callId','contentCorrelationId') if row.get(field))
        if in_session_window(row.get('createdDateTime'),row.get('endDateTime'),window) is True or linked:
            identity=(row.get('contentCorrelationId') or row['id'],first,last)
            if identity in seen:
                continue
            seen.add(identity)
            previous=found.get(row['id'])
            if not previous or last>_instant(previous['endDateTime']):
                found[row['id']]=row
    return sorted(found.values(),key=lambda row:(_instant(row['createdDateTime']),row['id']))


def artifact_metadata(artifact):
    metadata=artifact.get('metadata') or {}
    return {**metadata,'id':artifact.get('graph_artifact_id'),
        'callId':metadata.get('callId') or artifact.get('call_id'),
        'contentCorrelationId':metadata.get('contentCorrelationId') or artifact.get('content_correlation_id'),
        'createdDateTime':artifact.get('created_datetime'),'endDateTime':artifact.get('end_datetime')}


def merge_transcripts(*values):
    """Keep every distinct part; a complete saved transcript may contain a part."""
    values=[value for value in values if value and value.get('content')]
    parts=[]
    for value in values:
        text=value['content'].strip()
        if any(text in previous['content'] for previous in parts):
            continue
        parts=[previous for previous in parts if previous['content'].strip() not in text]
        parts.append(value)
    if not parts:
        return None
    stamps=[value['updatedAt'] for value in parts if value.get('updatedAt')]
    return {**parts[0],'content':'\n\n'.join(value['content'] for value in parts),
        'partCount':sum(value.get('partCount',1) for value in parts),
        'durationSeconds':parts[0].get('durationSeconds') if len(parts)==1 else None,
        'updatedAt':max(stamps) if stamps else None}


def evidence_metadata(data):
    """Drawer discovery needs availability; full bodies belong in PDF responses."""
    transcript=data.get('transcript')
    return {**data,'metadataOnly':True,
        'transcript':{key:value for key,value in transcript.items() if key!='content'} if transcript else None,
        'analyses':[{**{key:value for key,value in row.items() if key!='report'},
            'reportAvailable':row.get('status')=='completed' and row.get('report') is not None}
            for row in data.get('analyses',[])]}
