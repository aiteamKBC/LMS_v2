"""Import the legacy MBA quizzes — questions, options and pass marks.

The first curriculum import created a quiz *component* for every legacy quiz but
could not create the quiz itself: the export carried only a pass mark, so 4,240
components pointed at nothing. The export now includes a ``quiz_definition`` on
each quiz material, so this fills in what was missing:

    quiz_definition        -> curriculum.quizzes            (one per component)
    definition.questions[] -> curriculum.quiz_questions
    question.answer_options-> curriculum.quiz_answers
                           -> curriculum.quiz_component_links  (what makes the
                              component open as a quiz for a learner)
                           -> curriculum.quiz_course_links

Run the structure import first: a quiz is attached to the component row it
belongs to, and components this command cannot find are reported, not created.

    python manage.py import_mba_quizzes --dry-run
    python manage.py import_mba_quizzes
    python manage.py import_mba_quizzes --courses 48948

Re-runs replace the questions of quizzes this importer owns (``author`` is
AUTHOR) and leave every other quiz alone, so a quiz somebody has since edited by
hand in the builder is never overwritten.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import OperationalError, connection, transaction

from curriculum_api import views
from curriculum_api.management.commands.import_mba_curriculum import (
    DEFAULT_PROGRAMME, course_label, legacy_rows, parse_duration_hours,
)
from quiz_api.views import AI_GENERATION_QUESTION_TYPES, _normalise_question_type

#: Marks the quizzes this importer owns, so a re-run only replaces its own.
AUTHOR = 'MBA legacy import'

#: The only values quizzes.default_question_type and quiz_questions.question_type
#: accept — the database enforces this with a check constraint, and it is the same
#: set the app itself generates.
ALLOWED_QUESTION_TYPES = set(AI_GENERATION_QUESTION_TYPES)

#: Legacy question types the app's own normaliser does not know about.
LEGACY_TYPE_ALIASES = {
    'item_match': 'matching',
    'image_match': 'image_matching',
    'fill_the_gap': 'fill_gap',
    # A reference to the old LMS's question bank. Nothing carries the bank
    # itself, so it lands as an ordinary question with whatever options it has.
    'question_bank': 'single_choice',
}

DEFAULT_PASSING_GRADE = 65
DEFAULT_DURATION_MINUTES = 60

#: Neon closes a connection it considers idle or long-lived, which over a run of
#: this length is expected rather than exceptional. A dropped connection is
#: reopened and the quiz retried; only a repeat failure is reported.
CONNECTION_ATTEMPTS = 3


def question_type_for(raw):
    """A legacy question_type as one of the eight this schema allows.

    Anything unrecognised becomes a single-choice question rather than failing
    the insert: the questions and options are still worth importing, and the
    type is the part staff can correct in the builder.
    """
    text = str(raw or '').strip().lower()
    normalised = _normalise_question_type(LEGACY_TYPE_ALIASES.get(text, text))
    return normalised if normalised in ALLOWED_QUESTION_TYPES else 'single_choice'


def quiz_duration_minutes(material):
    hours = parse_duration_hours(
        material.get('configured_duration'), material.get('configured_duration_measure'),
    )
    return int(round(hours * 60)) if hours else DEFAULT_DURATION_MINUTES


class Command(BaseCommand):
    help = 'Import legacy MBA quiz questions and link them to their components.'

    def add_arguments(self, parser):
        parser.add_argument('--programme', default=DEFAULT_PROGRAMME)
        parser.add_argument('--courses', default='',
                            help='Comma-separated legacy course_ids; default is every course.')
        parser.add_argument('--limit', type=int, default=None,
                            help='Only the first N courses (by course_id).')
        parser.add_argument('--skip-existing', action='store_true',
                            help='Leave components that already have an imported quiz alone. '
                                 'Makes a restart cheap: a long run can be stopped and resumed '
                                 'without re-writing the quizzes it already did.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Report what would be imported and write nothing.')

    def handle(self, *args, **options):
        self.dry_run = options['dry_run']
        self.skip_existing = options['skip_existing']
        self.programme_id = views.clean_str(options['programme'])
        course_ids = [int(value) for value in options['courses'].replace(' ', '').split(',') if value]
        rows = list(legacy_rows(course_ids or None, options['limit']))
        if not rows:
            raise CommandError('The legacy export returned no courses.')

        programme_name = self.programme_name()
        self.stats = {
            'quizzes': 0, 'updated': 0, 'questions': 0, 'answers': 0,
            'no_component': 0, 'no_questions': 0, 'foreign_quiz': 0, 'already_done': 0,
            'connection_failures': 0,
            'questions_without_a_correct_option': 0, 'questions_without_options': 0,
        }
        self.problems = []

        for record in rows:
            payload = record['curriculum']
            module_id = views.clean_str(payload.get('module_id') or record.get('module_id'))
            module_title = course_label(record)
            quiz_materials = [
                (section, material)
                for section in payload.get('sections') or []
                for material in section.get('materials') or []
                if material.get('component_kind') == 'quiz'
            ]
            if not quiz_materials:
                continue
            before = self.stats['quizzes'] + self.stats['updated']
            for _section, material in quiz_materials:
                self.import_with_retry(material, module_id, module_title, programme_name)
            self.stdout.write(
                f'  {module_title[:46]:<46} '
                f'{self.stats["quizzes"] + self.stats["updated"] - before:>4} quizzes, '
                f'{self.stats["questions"]:>6} questions so far'
            )

        verb = 'would import' if self.dry_run else 'imported'
        self.stdout.write(self.style.SUCCESS(
            f'Quizzes {verb}: {self.stats["quizzes"]} new, {self.stats["updated"]} replaced, '
            f'{self.stats["questions"]} questions, {self.stats["answers"]} answer options'
        ))
        for key in ('already_done', 'no_component', 'no_questions', 'foreign_quiz',
                    'connection_failures',
                    'questions_without_options', 'questions_without_a_correct_option'):
            if self.stats[key]:
                self.stdout.write(f'  {key.replace("_", " ")}: {self.stats[key]}')
        for line in self.problems[:15]:
            self.stdout.write(f'    {line}')
        if len(self.problems) > 15:
            self.stdout.write(f'    … and {len(self.problems) - 15} more')

    def import_with_retry(self, material, module_id, module_title, programme_name):
        """One quiz, retried through a dropped database connection.

        The run takes hours against a serverless Postgres that closes
        connections on its own schedule; without this, one drop ends the job and
        every remaining course waits for somebody to restart it.
        """
        for attempt in range(1, CONNECTION_ATTEMPTS + 1):
            try:
                self.import_one(material, module_id, module_title, programme_name)
                return
            except OperationalError as error:
                connection.close()  # force a fresh one on the next query
                if attempt == CONNECTION_ATTEMPTS:
                    self.stats['connection_failures'] += 1
                    self.problems.append(
                        f'connection lost on {views.clean_str(material.get("component_id"))}: {error}'
                    )
                    return
                self.stderr.write(f'  database connection lost, retrying ({attempt}/{CONNECTION_ATTEMPTS})')

    # -- helpers ------------------------------------------------------------

    def programme_name(self):
        with connection.cursor() as cursor:
            cursor.execute('select name from curriculum.programmes where programme_id = %s',
                           [self.programme_id])
            row = cursor.fetchone()
        if not row:
            raise CommandError(f'Programme {self.programme_id} does not exist.')
        return row[0]

    def component_row(self, component_id):
        with connection.cursor() as cursor:
            cursor.execute(
                'select id, week_id, module_catalogue_id, settings_json from curriculum.components '
                'where id = %s', [component_id],
            )
            row = cursor.fetchone()
        if not row:
            return None
        return {'id': row[0], 'week_id': row[1], 'module_catalogue_id': row[2],
                'settings': views.parse_json_value(row[3], {})}

    def existing_quiz(self, component_id):
        """``(quiz_id, author)`` already linked to this component, or None."""
        with connection.cursor() as cursor:
            cursor.execute(
                'select q.id, coalesce(q.author, %s) from curriculum.quiz_component_links l '
                'join curriculum.quizzes q on q.id = l.quiz_id where l.component_id = %s '
                'order by l.id limit 1',
                ['', component_id],
            )
            row = cursor.fetchone()
        return (row[0], row[1]) if row else None

    # -- one quiz -----------------------------------------------------------

    def import_one(self, material, module_id, module_title, programme_name):
        component_id = views.clean_str(material.get('component_id'))
        definition = material.get('quiz_definition') or {}
        questions = [q for q in (definition.get('questions') or []) if isinstance(q, dict)]
        title = views.clean_str(material.get('title')) or 'Quiz'

        component = self.component_row(component_id)
        if component is None:
            self.stats['no_component'] += 1
            self.problems.append(f'no component row for {component_id} ({title[:50]})')
            return
        if not questions:
            # The export has the quiz but no questions for it; leave the
            # component as it is rather than linking an empty quiz.
            self.stats['no_questions'] += 1
            self.problems.append(f'no questions in the export: {title[:60]}')
            return

        existing = self.existing_quiz(component_id)
        if existing and existing[1] == AUTHOR and self.skip_existing:
            self.stats['already_done'] += 1
            return
        if existing and existing[1] != AUTHOR:
            # Somebody built this quiz in the app; an import must not replace it.
            self.stats['foreign_quiz'] += 1
            self.problems.append(
                f'quiz {existing[0]} on {component_id} was not created by this import — left alone'
            )
            return

        prepared = self.prepare_questions(questions, title)
        if self.dry_run:
            self.stats['updated' if existing else 'quizzes'] += 1
            self.stats['questions'] += len(prepared)
            self.stats['answers'] += sum(len(options) for _text, _type, options in prepared)
            return

        with transaction.atomic():
            quiz_id = existing[0] if existing else None
            with connection.cursor() as cursor:
                fields = {
                    'title': title[:255],
                    'module': module_title[:255],
                    'programme': programme_name,
                    'programme_id': self.programme_id,
                    'week_id': views.clean_str(component['week_id']),
                    'questions': len(prepared),
                    'status': 'published',
                    'author': AUTHOR,
                    'passing_grade': views.parse_int(
                        material.get('passing_grade_percent'), DEFAULT_PASSING_GRADE,
                    ) or DEFAULT_PASSING_GRADE,
                    'duration': quiz_duration_minutes(material),
                    'time_unit': 'minutes',
                    'default_question_type': prepared[0][1],
                    'assessment_type': 'quiz',
                    'mapped_components': 1,
                    'linked_courses': 1,
                    'schema_valid': True,
                }
                if quiz_id:
                    assignments = ', '.join(f'{views.quote_ident(k)} = %s' for k in fields)
                    cursor.execute(
                        f'update curriculum.quizzes set {assignments}, updated_at = now() where id = %s',
                        [*fields.values(), quiz_id],
                    )
                    # Its questions are replaced wholesale; answers go with them.
                    cursor.execute(
                        'delete from curriculum.quiz_answers where question_id in '
                        '(select id from curriculum.quiz_questions where quiz_id = %s)', [quiz_id],
                    )
                    cursor.execute('delete from curriculum.quiz_questions where quiz_id = %s', [quiz_id])
                    self.stats['updated'] += 1
                else:
                    columns = ', '.join(views.quote_ident(k) for k in fields)
                    placeholders = ', '.join(['%s'] * len(fields))
                    cursor.execute(
                        f'insert into curriculum.quizzes ({columns}) values ({placeholders}) returning id',
                        list(fields.values()),
                    )
                    quiz_id = cursor.fetchone()[0]
                    self.stats['quizzes'] += 1

                question_ids = self.insert_questions(cursor, quiz_id, prepared)
                self.insert_answers(cursor, question_ids, prepared)

                cursor.execute(
                    'insert into curriculum.quiz_component_links (quiz_id, component_id) '
                    'select %s, %s where not exists (select 1 from curriculum.quiz_component_links '
                    'where quiz_id = %s and component_id = %s)',
                    [quiz_id, component_id, quiz_id, component_id],
                )
                cursor.execute(
                    'insert into curriculum.quiz_course_links (quiz_id, module_catalogue_id, week_id) '
                    'select %s, %s, %s where not exists (select 1 from curriculum.quiz_course_links '
                    'where quiz_id = %s and module_catalogue_id = %s)',
                    [quiz_id, module_id, views.clean_str(component['week_id']), quiz_id, module_id],
                )

            self.link_component(component, quiz_id, material, len(prepared))

    def prepare_questions(self, questions, quiz_title):
        """``[(text, type, [(option_text, is_correct, order)])]`` in export order."""
        prepared = []
        for index, question in enumerate(questions, start=1):
            text = views.clean_str(question.get('question_text') or question.get('title'))
            if not text:
                continue
            options = []
            for order, option in enumerate(question.get('answer_options') or [], start=1):
                option_text = views.clean_str(option.get('option_text'))
                if not option_text:
                    continue
                options.append((
                    option_text,
                    bool(option.get('is_correct')),
                    views.parse_int(option.get('option_order'), order) or order,
                ))
            question_type = question_type_for(question.get('question_type'))
            # The legacy label does not distinguish "pick one of several" from
            # "pick every correct one" — both are stored as multi_choice — so for
            # choice questions the options decide it. Getting this wrong shows a
            # learner checkboxes where the question wants a single answer.
            if question_type in {'single_choice', 'multiple_choice'}:
                correct_count = sum(1 for _text, is_correct, _order in options if is_correct)
                question_type = 'multiple_choice' if correct_count > 1 else 'single_choice'
            if not options:
                self.stats['questions_without_options'] += 1
                self.problems.append(f'no options: {quiz_title[:40]} / {text[:50]}')
            elif not any(is_correct for _text, is_correct, _order in options):
                # A learner cannot pass this question; staff have to fix it in
                # the builder, so it is imported and reported rather than hidden.
                self.stats['questions_without_a_correct_option'] += 1
                self.problems.append(f'no correct option: {quiz_title[:40]} / {text[:50]}')
            prepared.append((text, question_type, options))
        return prepared

    def insert_questions(self, cursor, quiz_id, prepared):
        """Insert every question in one statement and keep the ids in order."""
        values, params = [], []
        for order, (text, question_type, _options) in enumerate(prepared, start=1):
            values.append('(%s, %s, %s, %s, %s)')
            params.extend([quiz_id, text, question_type, 1, order])
        cursor.execute(
            'insert into curriculum.quiz_questions '
            '(quiz_id, question_text, question_type, points, sort_order) values '
            + ', '.join(values) + ' returning id',
            params,
        )
        ids = [row[0] for row in cursor.fetchall()]
        self.stats['questions'] += len(ids)
        return ids

    def insert_answers(self, cursor, question_ids, prepared):
        values, params = [], []
        for question_id, (_text, _type, options) in zip(question_ids, prepared):
            for option_text, is_correct, order in options:
                values.append('(%s, %s, %s, %s)')
                params.extend([question_id, option_text, is_correct, order])
        if not values:
            return
        cursor.execute(
            'insert into curriculum.quiz_answers (question_id, answer_text, is_correct, sort_order) '
            'values ' + ', '.join(values),
            params,
        )
        self.stats['answers'] += len(values)

    def link_component(self, component, quiz_id, material, question_count):
        """Point the component's settings at the quiz that now exists."""
        settings = dict(component['settings'] or {})
        settings.update({
            'linkedQuizId': str(quiz_id),
            'numberOfQuestions': question_count,
            'passMarkPercentage': views.parse_int(
                material.get('passing_grade_percent'), DEFAULT_PASSING_GRADE,
            ) or DEFAULT_PASSING_GRADE,
            'buildMode': 'Imported from legacy LMS',
        })
        settings = views.normalise_component_settings_payload('quiz', settings)
        views.update_rows(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component['id']],
            {'settings_json': views.json_db_value(settings)},
        )
