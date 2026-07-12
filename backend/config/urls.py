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
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
<<<<<<< HEAD
    path('curriculum_api/', include('curriculum_api.urls')),
    path('admin/', admin.site.urls),
    path('coach_api/', include('coach_api.urls')),
    path('quiz_api/', include('quiz_api.urls')),
    path('learner_api/', include('learner_api.urls')),
=======
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
]
