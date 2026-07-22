from django.db import models


class Reward(models.Model):
    """A single item in the rewards catalogue (points -> voucher/merchandise)."""

    DELIVERY_TYPE_CHOICES = [
        ('physical', 'Physical'),
        ('digital', 'Digital'),
    ]

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    points = models.IntegerField()
    category = models.CharField(max_length=100, blank=True, default='')
    delivery_type = models.CharField(max_length=20, choices=DELIVERY_TYPE_CHOICES)
    stock = models.IntegerField(default=0)
    total_claimed = models.IntegerField(default=0)
    image = models.TextField(blank=True, default='')
    popular = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."rewards".
        db_table = 'Engagement"."rewards'

    def __str__(self):
        return self.name


class VoucherClaim(models.Model):
    """A learner's request to redeem a Reward for points."""

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('fulfilled', 'Fulfilled'),
    ]

    # Learner records live in another team's app (not in scope here yet), so
    # we just store the id/name the frontend sends rather than a real FK.
    learner_id = models.CharField(max_length=100)
    learner_name = models.CharField(max_length=255)

    reward = models.ForeignKey(Reward, on_delete=models.CASCADE, related_name='claims', db_column='reward_id')
    points = models.IntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    requested_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.CharField(max_length=255, null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    delivery_type = models.CharField(max_length=20, choices=Reward.DELIVERY_TYPE_CHOICES)
    delivery_method = models.CharField(max_length=20, blank=True, default='')
    delivery_detail = models.CharField(max_length=255, null=True, blank=True)
    delivery_instructions = models.TextField(null=True, blank=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."voucher_claims".
        db_table = 'Engagement"."voucher_claims'

    def __str__(self):
        return f'{self.learner_name} -> {self.reward.name} ({self.status})'


class Recognition(models.Model):
    """A badge/certificate/spotlight/etc. awarded to a learner."""

    TYPE_CHOICES = [
        ('badge', 'Badge'),
        ('certificate', 'Certificate'),
        ('spotlight', 'Spotlight'),
        ('milestone', 'Milestone'),
        ('achievement', 'Achievement'),
    ]

    # Learner records live in another team's app (not in scope here yet), so
    # we just store the id/name the frontend sends rather than a real FK.
    learner_id = models.CharField(max_length=100)
    learner_name = models.CharField(max_length=255)
    avatar_img = models.TextField(null=True, blank=True)
    programme_code = models.CharField(max_length=50)
    programme = models.CharField(max_length=255)
    cohort = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    title = models.CharField(max_length=255)
    description = models.TextField()
    awarded_by = models.CharField(max_length=255)
    awarded_at = models.DateTimeField(auto_now_add=True)
    category = models.CharField(max_length=100)
    points = models.IntegerField(default=0)
    is_public = models.BooleanField(default=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."recognitions".
        db_table = 'Engagement"."recognitions'

    def __str__(self):
        return f'{self.title} -> {self.learner_name}'


class Event(models.Model):
    """An engagement event (workshop, social, competition, etc.)."""

    TYPE_CHOICES = [
        ('workshop', 'Workshop'),
        ('social', 'Social'),
        ('networking', 'Networking'),
        ('competition', 'Competition'),
        ('celebration', 'Celebration'),
    ]
    STATUS_CHOICES = [
        ('upcoming', 'Upcoming'),
        ('ongoing', 'Ongoing'),
        ('completed', 'Completed'),
    ]

    title = models.CharField(max_length=255)
    description = models.TextField()
    # Kept as free text (not DateField/TimeField) to match the frontend's
    # display strings, e.g. '13 Jun 2026' / '13:00 - 15:00'.
    date = models.CharField(max_length=100)
    time = models.CharField(max_length=100)
    location = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    attendees = models.IntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='upcoming')
    organizer = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."events".
        db_table = 'Engagement"."events'

    def __str__(self):
        return self.title


class EventBooking(models.Model):
    """A learner RSVP for a community event."""

    STATUS_CHOICES = [
        ('booked', 'Booked'),
        ('cancelled', 'Cancelled'),
    ]

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name='bookings', db_column='event_id')
    learner_id = models.CharField(max_length=100)
    learner_name = models.CharField(max_length=255)
    learner_email = models.EmailField(blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='booked')
    booked_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'Engagement"."event_bookings'
        constraints = [
            models.UniqueConstraint(fields=['event', 'learner_id'], name='engagement_event_booking_unique'),
        ]

    def __str__(self):
        return f'{self.learner_name} -> {self.event.title} ({self.status})'


class Club(models.Model):
    """A regional community club learners can join (London Club, Kent Club, etc.)."""

    name = models.CharField(max_length=255)
    location = models.CharField(max_length=255)
    description = models.TextField()
    ambassador = models.CharField(max_length=255)
    ambassador_role = models.CharField(max_length=255)
    members = models.IntegerField(default=0)
    # Array of initials strings for the joined-members indicator stack, e.g. ["SW", "OP"].
    sample_members = models.JSONField(default=list)
    active = models.BooleanField(default=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."clubs".
        db_table = 'Engagement"."clubs'

    def __str__(self):
        return self.name


class ClubMeeting(models.Model):
    """A single meetup belonging to a Club — scheduled or awaiting a date."""

    club = models.ForeignKey(Club, on_delete=models.CASCADE, related_name='meetings', db_column='club_id')
    title = models.CharField(max_length=255)
    scheduled = models.BooleanField(default=False)
    date = models.CharField(max_length=100, null=True, blank=True)
    time = models.CharField(max_length=100, null=True, blank=True)
    venue = models.CharField(max_length=255, null=True, blank=True)
    attendees = models.IntegerField(default=0)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."club_meetings".
        db_table = 'Engagement"."club_meetings'

    def __str__(self):
        return f'{self.title} ({self.club.name})'


class PointsRule(models.Model):
    """A configured rule for how learners earn engagement points."""

    name = models.CharField(max_length=255)
    description = models.TextField()
    points = models.IntegerField()
    category = models.CharField(max_length=100)
    frequency = models.CharField(max_length=100)
    trigger = models.CharField(max_length=255)
    active = models.BooleanField(default=True)
    # Stable identifier other apps use to call services.grant_points() —
    # e.g. 'session_attendance' — instead of matching on the editable
    # display name. Optional: manual-only rules (a human clicks "award")
    # don't need one.
    key = models.CharField(max_length=100, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."points_rules".
        db_table = 'Engagement"."points_rules'

    def __str__(self):
        return self.name


class PointsGrant(models.Model):
    """A single award of points to a learner under a PointsRule.

    Stores its own `points` snapshot (rather than looking it up from the
    rule at read time) so grant history stays accurate even if the rule's
    point value is edited later.
    """

    rule = models.ForeignKey(PointsRule, on_delete=models.CASCADE, related_name='grants', db_column='rule_id')
    # Learner records live in another team's app (not in scope here yet), so
    # we just store the id/name the frontend sends rather than a real FK.
    learner_id = models.CharField(max_length=100)
    learner_name = models.CharField(max_length=255)
    points = models.IntegerField()
    awarded_at = models.DateTimeField(auto_now_add=True)
    # Idempotency key: identifies the specific real-world occurrence that
    # earned this grant (e.g. an attendance record id). Lets
    # services.grant_points() recognise a repeat call for the same
    # occurrence and return the existing grant instead of double-granting.
    # NULL for manual grants, which are allowed to repeat freely.
    event_reference = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."points_grants".
        db_table = 'Engagement"."points_grants'

    def __str__(self):
        return f'{self.learner_name} -> {self.rule.name} (+{self.points})'


class FlashCardDeck(models.Model):
    """One authored batch of flash cards, targeted at a programme/module/week.

    Mirrors the quiz builder's QuizPackage: a curriculum/engagement author
    builds a deck for a specific programme -> module -> week, and `week_id`
    uses the SAME format the quiz builder computes
    (week-training-module-{programme_id}-{week_number}) so a later delivery
    step can reach exactly the learners a quiz for that week reaches.

    Unlike a quiz, a deck is a points-only game: it is never injected into the
    training plan and never affects progress/OTJH.
    """

    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('published', 'Published'),
    ]

    title = models.CharField(max_length=255)
    # Curriculum programme/module identifier. Plain field, no FK, matching the
    # same rationale as learner_id elsewhere.
    programme_id = models.IntegerField(null=True, blank=True)
    programme = models.CharField(max_length=255, blank=True, default='')
    module = models.CharField(max_length=255, blank=True, default='')
    week_id = models.CharField(max_length=128, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    author = models.CharField(max_length=255, blank=True, default='')
    card_count = models.IntegerField(default=0)
    ai_generated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."flash_card_decks".
        db_table = 'Engagement"."flash_card_decks'

    def __str__(self):
        return self.title


class FlashCard(models.Model):
    """One question/answer card belonging to a FlashCardDeck.

    `question` is the front (prompt), `answer` is the back (concise answer).
    Mirrors the quiz builder's QuizQuestion.
    """

    DIFFICULTY_CHOICES = [
        ('easy', 'Easy'),
        ('medium', 'Medium'),
        ('hard', 'Hard'),
    ]

    deck = models.ForeignKey(FlashCardDeck, on_delete=models.CASCADE, related_name='cards', db_column='deck_id')
    question = models.TextField()
    answer = models.TextField()
    category = models.CharField(max_length=100, blank=True, default='')
    difficulty = models.CharField(max_length=20, choices=DIFFICULTY_CHOICES, default='medium')
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."flash_cards".
        db_table = 'Engagement"."flash_cards'
        ordering = ['sort_order', 'id']

    def __str__(self):
        return f'[deck {self.deck_id}] {self.question[:40]}'


class FlashCardView(models.Model):
    """A record of a learner flipping a specific flash card.

    One row per (card, learner) — the DB UNIQUE(flash_card_id, learner_id)
    constraint is what enforces "points awarded once per card per learner,
    ever". Next week's deck has new card ids, so its cards award again.

    Learner records live in another team's app (not in scope here yet), so we
    store the id/name the frontend sends rather than a real FK.
    """

    flash_card = models.ForeignKey(FlashCard, on_delete=models.CASCADE, related_name='views', db_column='flash_card_id')
    learner_id = models.CharField(max_length=100)
    learner_name = models.CharField(max_length=255)
    # Snapshot of what this flip awarded (the rule's value at flip time).
    points_awarded = models.IntegerField(default=0)
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        # Emitted by Django as "Engagement"."flash_card_views".
        db_table = 'Engagement"."flash_card_views'

    def __str__(self):
        return f'{self.learner_name} flipped card {self.flash_card_id}'
