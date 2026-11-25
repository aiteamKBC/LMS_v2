"""Api read responses. Explicit read capabilities preserve legacy contracts."""


def request_bypasses_curriculum_cache(request, *, clean_str, truthy):
    cache_control = clean_str(request.headers.get('Cache-Control')).lower()
    pragma = clean_str(request.headers.get('Pragma')).lower()
    return (
        'no-cache' in cache_control
        or 'no-store' in cache_control
        or 'no-cache' in pragma
        or truthy(request.GET.get('skipCache'))
        or clean_str(request.GET.get('_ts'))
    )


def reference_json_response(
    request, payload, *, DjangoJSONEncoder, HttpResponse, HttpResponseNotModified, clean_str, hashlib,
    json,
):
    """JSON response with a validating ETag, for reference data only.

    Suitable for endpoints whose body depends on nothing but the reference tables:
    no per-user, per-role or per-programme variation. The ETag is derived from the
    serialised body, so it changes exactly when the content does — there is no TTL
    to tune and no way to serve content that is newer than its validator.

    ``Cache-Control: private, no-cache`` makes the browser revalidate every time
    and keeps the payload out of shared caches; a match then costs a 304 with no
    body instead of the full response. Deliberately not ``public``: these endpoints
    sit behind authentication, so a shared cache must not retain them.
    """
    body = json.dumps(payload, cls=DjangoJSONEncoder)
    etag = f'"{hashlib.sha256(body.encode()).hexdigest()[:32]}"'
    if_none_match = clean_str(request.headers.get('If-None-Match'))
    if if_none_match and etag in [value.strip() for value in if_none_match.split(',')]:
        response = HttpResponseNotModified()
    else:
        response = HttpResponse(body, content_type='application/json')
    response['ETag'] = etag
    response['Cache-Control'] = 'private, no-cache'
    return response


def paginate_curriculum_results(request, results, max_page_size=250, *, clean_str, parse_int):
    """Apply opt-in pagination while preserving legacy unpaginated clients."""
    raw_page = clean_str(request.GET.get('page'))
    raw_page_size = clean_str(request.GET.get('page_size') or request.GET.get('pageSize'))
    if not raw_page and not raw_page_size:
        return results, None
    page = max(1, parse_int(raw_page, 1))
    page_size = min(max_page_size, max(1, parse_int(raw_page_size, 50)))
    total = len(results)
    start = (page - 1) * page_size
    return results[start:start + page_size], {
        'count': total,
        'page': page,
        'pageSize': page_size,
        'pages': (total + page_size - 1) // page_size,
        'hasNext': start + page_size < total,
        'hasPrevious': page > 1,
    }


def curriculum_collection_response(
    payload, key, results=None, request=None, *, JsonResponse, paginate_curriculum_results,
):
    results = payload[key] if results is None else results
    page_meta = None
    if request is not None:
        results, page_meta = paginate_curriculum_results(request, results)
    response = {
        'schema': payload['schema'],
        'count': page_meta['count'] if page_meta else len(results),
        'results': results,
    }
    if page_meta:
        response.update({key: value for key, value in page_meta.items() if key != 'count'})
    return JsonResponse(response)


def curriculum_results_response(
    results, request=None, *, CURRICULUM_SCHEMA, JsonResponse, paginate_curriculum_results,
):
    page_meta = None
    if request is not None:
        results, page_meta = paginate_curriculum_results(request, results)
    response = {
        'schema': CURRICULUM_SCHEMA,
        'count': page_meta['count'] if page_meta else len(results),
        'results': results,
    }
    if page_meta:
        response.update({key: value for key, value in page_meta.items() if key != 'count'})
    return JsonResponse(response)
