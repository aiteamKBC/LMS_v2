"""Liveness endpoint for the AWS load balancer (ECS staging/production).

``GET /health/`` is answered here, outside Django, before any middleware or
scheduler wrapper runs. The load balancer calls each task by its private IP,
which is never in ALLOWED_HOSTS, so a Django view would answer 400. The
response only says "this process accepts HTTP"; it deliberately touches no
database, cache or external service, so a Neon or Valkey hiccup does not make
the load balancer kill every task at once.

Every other request, WebSocket and lifespan event is passed through unchanged.
"""

HEALTH_PATH = '/health/'


def with_health_check(app):
    async def application(scope, receive, send):
        if scope['type'] == 'http' and scope.get('path') == HEALTH_PATH:
            await send({
                'type': 'http.response.start',
                'status': 200,
                'headers': [
                    (b'content-type', b'text/plain'),
                    (b'cache-control', b'no-store'),
                ],
            })
            await send({'type': 'http.response.body', 'body': b'ok'})
            return
        await app(scope, receive, send)

    return application
