"""Ollama transport for proofreading; never calls a cloud fallback."""
import json
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlsplit

from django.conf import settings


def proofread(messages, schema):
    base_url = settings.OLLAMA_BASE_URL.rstrip('/')
    parsed = urlsplit(base_url)
    if parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise ValueError('Local proofreading requires a loopback Ollama URL.')
    model = settings.OLLAMA_PROOFREAD_MODEL
    if 'cloud' in model.lower():
        raise ValueError('A downloaded local model is required.')
    body = json.dumps({
        'model': model, 'messages': messages, 'format': schema,
        'stream': False, 'keep_alive': '5m',
        'options': {'temperature': 0, 'num_ctx': 8192, 'num_predict': 2048},
    }).encode('utf-8')
    request = Request(base_url + '/api/chat', data=body, headers={'Content-Type': 'application/json'})
    # Ignore system HTTP proxies: learner text must stay on the local machine.
    with build_opener(ProxyHandler({})).open(request, timeout=settings.OLLAMA_PROOFREAD_TIMEOUT) as response:
        result = json.loads(response.read(1_000_001))
    if result.get('done_reason') == 'length':
        raise ValueError('Local model response was truncated.')
    reviewed = json.loads(result['message']['content'])
    if (not isinstance(reviewed, dict) or type(reviewed.get('accepted')) is not bool
            or not isinstance(reviewed.get('improved_text'), str)
            or not isinstance(reviewed.get('reason'), str)):
        raise ValueError('Invalid local proofreading response.')
    return reviewed
