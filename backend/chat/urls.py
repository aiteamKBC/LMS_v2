from django.urls import path

from .views import (
    ChatSessionLogoutView,
    ChatSessionView,
    ConversationListView,
    ConversationMessagesView,
    MessageReadView,
)

app_name = "chat"

urlpatterns = [
    path("session/", ChatSessionView.as_view(), name="chat-session"),
    path("session/logout/", ChatSessionLogoutView.as_view(), name="chat-session-logout"),
    path("conversations/", ConversationListView.as_view(), name="conversation-list"),
    path(
        "conversations/<int:conversation_id>/messages/",
        ConversationMessagesView.as_view(),
        name="conversation-messages",
    ),
    path("messages/<int:message_id>/read/", MessageReadView.as_view(), name="message-read"),
]
