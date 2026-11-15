"""Move inline (base64) quiz images into upload storage.

Question images (``curriculum.quiz_questions.image_url``) and image-matching
answer pictures (the ``imageUrl`` inside ``curriculum.quiz_answers.answer_text``)
were kept as ``data:image/...;base64`` strings. The save paths now store them as
files (quiz_api.question_images); this command moves what is already there.

* Dry run by default: reports what would move and stores nothing.
* ``--apply`` stores each distinct picture once (content-addressed, so a re-run
  or a picture shared by several questions is one file) and rewrites the rows.
* Each row is updated only while it still holds the value this run read, so an
  edit made meanwhile is never overwritten. Row ids are unchanged, so answer
  identities used by past attempts stay valid.
* Learner attempt snapshots (``Learner.learner_quiz_answers``) are history and
  are not touched.
"""
import json

from django.core.management.base import BaseCommand
from django.db import connection, transaction

from quiz_api.question_images import store_question_image, stored_answer_text


class Command(BaseCommand):
    help = 'Store inline quiz images as files and replace them with their URLs. Dry-run unless --apply.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Store the images and rewrite the rows.')

    def handle(self, *args, **options):
        apply_changes = options['apply']
        with connection.cursor() as cursor:
            cursor.execute(
                "select id, image_url from curriculum.quiz_questions where image_url like 'data:%%' order by id"
            )
            questions = cursor.fetchall()
            cursor.execute(
                "select id, answer_text from curriculum.quiz_answers "
                "where answer_text like '{%%' and answer_text like '%%data:image/%%' order by id"
            )
            answers = cursor.fetchall()

        distinct = {value for _id, value in questions}
        self.stdout.write(
            f'{len(questions)} question image(s) inline ({len(distinct)} distinct, '
            f'{sum(len(v) for _i, v in questions):,} chars); {len(answers)} answer picture(s) inline.'
        )
        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry run: nothing stored, nothing updated. Re-run with --apply.'))
            return

        failed = []
        stored = {}
        for value in sorted(distinct):
            try:
                stored[value] = store_question_image(value)
            except ValueError as error:
                failed.append(f'question image ({error})')
        updated_questions = 0
        with transaction.atomic(), connection.cursor() as cursor:
            for row_id, value in questions:
                if value not in stored:
                    continue
                cursor.execute(
                    'update curriculum.quiz_questions set image_url = %s, updated_at = CURRENT_TIMESTAMP '
                    'where id = %s and image_url = %s',
                    [stored[value], row_id, value],
                )
                updated_questions += cursor.rowcount

        updated_answers = 0
        for row_id, text in answers:
            try:
                new_text = stored_answer_text(text)
            except ValueError as error:
                failed.append(f'answer {row_id} ({error})')
                continue
            if new_text == text:
                continue
            json.loads(new_text)  # never write a text the readers cannot parse
            with connection.cursor() as cursor:
                cursor.execute(
                    'update curriculum.quiz_answers set answer_text = %s, updated_at = CURRENT_TIMESTAMP '
                    'where id = %s and answer_text = %s',
                    [new_text, row_id, text],
                )
                updated_answers += cursor.rowcount

        self.stdout.write(self.style.SUCCESS(
            f'Stored {len(stored)} picture(s); updated {updated_questions} question(s) and {updated_answers} answer(s).'
        ))
        for item in failed:
            self.stdout.write(self.style.WARNING(f'  left inline: {item}'))
