from django.urls import path

from . import views

urlpatterns = [
    path("ai/generate-questions/", views.generate_ai_questions, name="generate-ai-questions"),
    path("training-plan-options/", views.training_plan_options, name="training-plan-options"),
    path("question-bank/", views.question_bank, name="question-bank"),
    path("question-bank/questions/<int:question_id>/add-to-quiz/", views.add_question_to_quiz, name="question-bank-add-to-quiz"),
    path("quizzes/", views.quizzes, name="quizzes"),
    path("quizzes/<int:pk>/", views.quiz_detail, name="quiz-detail"),
    path("quizzes/<int:pk>/course-links/", views.quiz_course_links, name="quiz-course-links"),
    path("quizzes/<int:pk>/download/", views.quiz_download, name="quiz-download"),
    path("quizzes/<int:pk>/preview/", views.quiz_preview, name="quiz-preview"),
    path("quizzes/<int:pk>/students/", views.quiz_students, name="quiz-students"),
    path("quizzes/<int:pk>/scorm/", views.quiz_scorm_launch, name="quiz-scorm-launch"),
    path("quizzes/<int:pk>/scorm/<path:asset_path>", views.quiz_scorm_launch, name="quiz-scorm-asset"),
    path("quizzes/<int:pk>/questions/", views.quiz_questions, name="quiz-questions"),
]
