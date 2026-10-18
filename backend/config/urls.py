"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from .batch import api_get_batch
from mcp_api import views as mcp_views
from system_audit import performance as system_performance

urlpatterns = [
    path('api/batch/', api_get_batch, name='api-get-batch'),
    # Production LiteSpeed forwards the established *_api prefixes to Django,
    # while unknown /api/* paths fall through to the SPA index. Keep the old
    # URL for compatibility and expose the transport below a forwarded prefix.
    path('coach_api/_batch/', api_get_batch, name='api-get-batch-proxied'),
    path('django_admin/', admin.site.urls),
    # Kept below an established production-forwarded prefix. Collection is
    # server-allowlisted and contains no payloads, query strings or identities.
    path('curriculum_api/performance/record/', system_performance.performance_record, name='performance-record'),
    path('curriculum_api/performance/report/', system_performance.performance_report, name='performance-report'),
    path('curriculum_api/knowledge-base/', include('knowledge_base.urls')),
    # Teams Calendar health (read-only views plus the confirmed resolution).
    path('curriculum_api/', include('curriculum_api.integrity_urls')),
    path('curriculum_api/', include('curriculum_api.urls')),
    path('coach_api/', include('coach_api.urls')),
    path('quiz_api/', include('quiz_api.urls')),
    path('learner_api/communications/', include('mobile_comms.urls')),
    path('learner_api/', include('learner_api.urls')),
    path('audit_api/', include('audit_api.urls')),
    # HOURS-TEST: the same audit API over the cloned Neon branch.
    path('hours_test_api/', include('audit_api.clone_urls')),
    path('manual_audit_api/', include('manual_audit_api.urls')),
    path('engagement_api/', include('engagement_api.urls')),
    path('enrolment_api/', include('enrolment_api.urls')),
    path('login_api/', include('login.urls')),
    path('api/chat/', include('chat.urls')),
    path('api/calendar/', include('learner_api.calendar_urls')),
    # Matches the *_api prefix pattern production LiteSpeed already forwards to
    # Django (see the comment above) -- keeping this under /api/ would silently
    # fall through to the SPA index instead of reaching this view.
    path('progress_reviews_api/', include('progress_reviews_api.urls')),
    # MCP server for AI connectors. 404 unless MCP_ENABLED; outside the *_api
    # prefixes, so production LiteSpeed must be told to forward these paths.
    path('mcp/', include('mcp_api.urls')),
    # Some MCP clients drop the slash, and APPEND_SLASH cannot redirect a POST.
    path('mcp', mcp_views.mcp_endpoint, name='mcp-endpoint-noslash'),
    path('oauth/', include('mcp_api.oauth_urls')),
    path('.well-known/oauth-protected-resource', mcp_views.oauth_protected_resource_metadata, name='oauth-protected-resource'),
    # RFC 9728 path forms, one per spelling of the MCP endpoint.
    path('.well-known/oauth-protected-resource/mcp', mcp_views.oauth_protected_resource_metadata, {'mcp_path': '/mcp'}, name='oauth-protected-resource-mcp'),
    path('.well-known/oauth-protected-resource/mcp/', mcp_views.oauth_protected_resource_metadata, {'mcp_path': '/mcp/'}, name='oauth-protected-resource-mcp-slash'),
    path('.well-known/oauth-authorization-server', mcp_views.oauth_authorization_server_metadata, name='oauth-authorization-server'),
]

if settings.DEBUG:
    urlpatterns += static('/media/absence-evidence/', document_root=settings.BASE_DIR / 'media' / 'absence-evidence')
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

