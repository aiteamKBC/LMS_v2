"""Run a synthetic local-only proofreading trial without loading database apps.

From backend: python scripts/try_local_proofreading.py
"""
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings

settings.configure(
    SECRET_KEY='local-proofreading-trial', DATABASES={},
    PROOFREAD_PROVIDER='ollama', OLLAMA_BASE_URL='http://127.0.0.1:11434',
    OLLAMA_PROOFREAD_MODEL='qwen2.5:1.5b', OLLAMA_PROOFREAD_TIMEOUT=120,
)
from django.test import RequestFactory
from learner_api.reflection_ai import proofread_reflection

examples = [
    ('grammar', 'I learned how to organise my daily tasks and this help me focus. '
     'I also asked questions when instructions was unclear instead of making assumptions.', 20),
    ('already_clear', 'I learned how to organise my daily tasks, identify priorities, and ask clear '
     'questions when instructions are unclear. These approaches helped me manage my workload more effectively.', 20),
    ('placeholder', 'Lorem ipsum ' * 20, 20),
]
for name, original, minimum in examples:
    start = time.monotonic()
    response = proofread_reflection(RequestFactory().post('/proofread/', data=json.dumps({
        'text': original, 'activityTitle': 'Monthly assignment', 'minimumWords': minimum,
    }), content_type='application/json'))
    result = json.loads(response.content)
    print(json.dumps({'case': name, 'seconds': round(time.monotonic() - start, 2),
                      'status': response.status_code, 'words': len(result.get('text', '').split()),
                      'result': result}, ensure_ascii=False), flush=True)
    if response.status_code >= 500:
        sys.exit(1)
