"""Bounded progress HTTP validation and journal-context selection after existing authorization."""


from ..application.progress import MissingProgressScope, ChangedProgressScope


def progress(request, *, SCOPES, JsonResponse, DatabaseError, learner_journal_view, read_progress):
    scope, identifier = request.GET.get('scope', ''), request.GET.get('id', '').strip()
    ids = list(dict.fromkeys(request.GET.get('learnerIds', '').split(',')))
    if scope not in SCOPES or not identifier or len(identifier) > 200 or not 1 <= len(ids) <= 5 or any(not value.isascii() or not value.isdecimal() or len(value) > 18 for value in ids):
        return JsonResponse({'error': 'Choose a valid scope and up to five learners.'}, status=400)

    @learner_journal_view
    def read(request):
        try:
            return JsonResponse({'learners': read_progress(scope, identifier, ids)})
        except MissingProgressScope:
            return JsonResponse({'error': 'This curriculum record could not be found.'}, status=404)
        except ChangedProgressScope:
            return JsonResponse({'error': 'A learner is no longer in this scope. Reload the list.'}, status=409)
        except DatabaseError:
            return JsonResponse({'error': 'Progress is temporarily unavailable. Please retry.'}, status=503)
    return read(request)
