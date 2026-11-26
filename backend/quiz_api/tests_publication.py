"""Mocked publication/import checks; no database or external operations."""
import io
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch
from django.test import RequestFactory, SimpleTestCase
from . import views
from .answer_keys import quiz_publication_error
from .models import QuizPackage
from curriculum_api.management.commands.import_mba_quizzes import Command


def question(correct=True, archived=False, kind="single_choice"):
    answers = [SimpleNamespace(answer_text="Yes", is_correct=correct, sort_order=0), SimpleNamespace(answer_text="No", is_correct=False, sort_order=1)]
    return SimpleNamespace(id=21, question_type=kind, is_archived=archived, answers=SimpleNamespace(all=lambda:answers), save=Mock())


class PublicationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.quiz = QuizPackage(id=7, title="Synthetic quiz", status="published")
        self.packages = Mock();self.packages.get.return_value = self.quiz
        self.packages.select_for_update.return_value = self.packages
        self.questions = Mock();self.active = []
        self.questions.filter.return_value.prefetch_related.side_effect = lambda *args:self.active
        patches = [patch.object(views,"_ensure_quiz_assessment_type_column"),
                   patch.object(views,"_serialize_quiz",side_effect=lambda quiz:{"status":quiz.status}),
                   patch.object(views.QuizPackage,"objects",self.packages),
                   patch.object(views.QuizQuestion,"objects",self.questions),
                   patch.object(views.transaction,"atomic",side_effect=nullcontext),
                   patch.object(QuizPackage,"refresh_from_db")]
        for p in patches:p.start();self.addCleanup(p.stop)
        p=patch.object(QuizPackage,"save");self.save=p.start();self.addCleanup(p.stop)

    def request(self, method, payload):
        return getattr(self.factory,method)("/quiz_api/quizzes/7/",json.dumps(payload),content_type="application/json")

    def test_publish_rejects_empty_quiz_and_missing_nonchoice_answers(self):
        for rows in [[],[question(kind="ordering")]]:
            if rows:rows[0].answers=SimpleNamespace(all=lambda:[])
            self.active=rows
            self.assertEqual(views.quiz_detail(self.request("patch",{"status":"published"}),7).status_code,400)
        self.save.assert_not_called()

    def test_publish_rejects_missing_and_conflicting_keys(self):
        for current in [question(False),question()]:
            if current.answers.all()[0].is_correct:current.answers.all()[1].is_correct=True
            self.active=[current]
            self.assertEqual(views.quiz_detail(self.request("patch",{"status":"published"}),7).status_code,400)
        self.save.assert_not_called()

    def test_valid_publish_uses_quiz_row_lock(self):
        self.quiz.status="draft";self.active=[question()]
        self.assertEqual(views.quiz_detail(self.request("patch",{"status":"published"}),7).status_code,200)
        self.assertEqual(self.quiz.status,"published")
        self.packages.select_for_update.assert_called_once();self.save.assert_called_once()

    def test_manual_creation_cannot_publish_empty_shell(self):
        self.assertEqual(views.quizzes(self.request("post",{"status":"published"})).status_code,400)
        self.packages.create.assert_not_called()

    def test_upload_cannot_publish_without_readable_questions(self):
        request=self.factory.post("/quiz_api/quizzes/",{"file":io.BytesIO(b"bad"),"status":"published"})
        request.FILES["file"].name="synthetic.xml"
        with patch.object(views,"_validate_xml",return_value=(False,"Invalid XML",0,"",[],{})), \
             patch.object(views,"_match_programme_catalogue_id",return_value=""), \
             patch.object(views,"_build_week_id",return_value=""):
            response=views.quizzes(request)
        self.assertEqual(response.status_code,400);self.packages.create.assert_not_called()

    def test_unarchiving_bad_question_without_answers_is_rejected(self):
        self.active=[question(False,True)]
        response=views.quiz_questions(self.request("patch",{"questions":[{"id":21,"isArchived":False}]}),7)
        self.assertEqual(response.status_code,400);self.active[0].save.assert_not_called()
        self.questions.create.assert_not_called()

    def test_archiving_last_question_is_rejected(self):
        self.active=[question()]
        response=views.quiz_questions(self.request("patch",{"questions":[{"id":21,"isArchived":True}]}),7)
        self.assertEqual(response.status_code,400);self.active[0].save.assert_not_called()

    def test_bank_copy_rejects_invalid_source_before_writes(self):
        self.questions.select_related.return_value.prefetch_related.return_value.get.return_value=question(False)
        response=views.add_question_to_quiz(self.request("post",{"quizId":7}),21)
        self.assertEqual(response.status_code,400);self.questions.create.assert_not_called()

    def test_legacy_import_reports_invalid_quiz_before_writes(self):
        command=Command();command.stats={};command.problems=[];command.skip_existing=False;command.dry_run=False
        command.component_row=Mock(return_value={"week_id":"synthetic"});command.existing_quiz=Mock(return_value=None)
        command.prepare_questions=Mock(return_value=[("Q","single_choice",[("Yes",False,1)])])
        with patch("curriculum_api.management.commands.import_mba_quizzes.transaction.atomic") as atomic:
            command.import_one({"component_id":"synthetic","title":"Synthetic","quiz_definition":{"questions":[{}]}},"module","Module","Programme")
        atomic.assert_not_called();self.assertIn("not imported",command.problems[0])

    def test_standalone_scorm_launch_is_preserved(self):
        self.quiz.package_type="scorm"
        self.assertEqual(views.quiz_detail(self.request("patch",{"status":"published"}),7).status_code,200)

    def test_shared_validator_ignores_archive_and_allows_supported_formats(self):
        for kind in views.AI_GENERATION_QUESTION_TYPES:
            self.assertIsNone(quiz_publication_error([{"type":kind,"answers":[{"text":"Yes","isCorrect":True}]},
                                                     {"type":"single_choice","answers":[],"isArchived":True}]))

    def test_drafts_can_keep_incomplete_keys(self):
        from .tests_question_images import QuestionImageTests
        response,manager=QuestionImageTests().save_questions([{"text":"Draft","questionType":"single_choice","answers":[]}])
        self.assertEqual(response.status_code,200);manager.create.assert_called_once()

    def test_unknown_type_cannot_publish(self):
        self.active = [question(kind="unsupported")]
        response = views.quiz_detail(self.request("patch", {"status": "published"}), 7)
        self.assertEqual(response.status_code, 400)
        self.save.assert_not_called()

    def test_metadata_only_edit_preserves_published_questions(self):
        self.active = [question()]
        response = views.quiz_detail(self.request("patch", {"title": "Updated title"}), 7)
        self.assertEqual(response.status_code, 200)
        self.questions.filter.assert_not_called()
        self.assertEqual(self.quiz.title, "Updated title")

    def test_valid_bank_copy_is_allowed_and_keeps_question_type(self):
        source = question()
        source.question_text = "Synthetic question"
        source.image_url = ""
        source.points = 1
        source.explanation = "Synthetic explanation"
        self.active = [question()]
        self.questions.select_related.return_value.prefetch_related.return_value.get.return_value = source
        self.questions.filter.return_value.aggregate.return_value = {"max_order": 0}
        self.questions.create.return_value = SimpleNamespace(id=22, question_text="Synthetic question")
        self.questions.filter.return_value.count.return_value = 2
        with patch.object(views.QuizAnswer.objects, "create") as answers:
            response = views.add_question_to_quiz(self.request("post", {"quizId": 7}), 21)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.questions.create.call_args.kwargs["question_type"], "single_choice")
        self.assertEqual(answers.call_count, 2)

    def test_duplicate_options_cannot_publish(self):
        current = question()
        current.answers.all()[1].answer_text = " yes "
        self.active = [current]
        response = views.quiz_detail(self.request("patch", {"status": "published"}), 7)
        self.assertEqual(response.status_code, 400)
        self.save.assert_not_called()

    def test_empty_native_upload_cannot_publish_even_if_parser_marks_valid(self):
        request = self.factory.post("/quiz_api/quizzes/", {"file": io.BytesIO(b"empty"), "status": "published"})
        request.FILES["file"].name = "synthetic.xml"
        with patch.object(views, "_validate_xml", return_value=(True, "", 0, "", [], {})), \
             patch.object(views, "_match_programme_catalogue_id", return_value=""), \
             patch.object(views, "_build_week_id", return_value=""):
            response = views.quizzes(request)
        self.assertEqual(response.status_code, 400)
        self.packages.create.assert_not_called()
