from django.conf import settings
from django.urls import path

from .consumers import ChatConsumer

# Chat is disabled (audit A10 — see chat/views.py). While the bootstrap flag is
# off, expose NO ws/chat/ route at all, so the ASGI ProtocolTypeRouter rejects
# the connection for everyone — including the six pre-existing Django sessions
# that would otherwise still authenticate over Channels (the WebSocket consumer
# reads the Django session, not the flag). Closing the route is the decisive fix
# rather than closing after handshake.
#
# NOTE (follow-up): this reuses CHAT_DEMO_BOOTSTRAP_ENABLED, whose name is really
# about the HTTP demo bootstrap. A dedicated backend CHAT_ENABLED setting gating
# the HTTP view, this route, and the bootstrap together would be cleaner — see
# A10 note / A18 in SECURITY_AUDIT.md.
if settings.CHAT_DEMO_BOOTSTRAP_ENABLED:
    websocket_urlpatterns = [
        path("ws/chat/<int:conversation_id>/", ChatConsumer.as_asgi()),
    ]
else:
    websocket_urlpatterns = []
