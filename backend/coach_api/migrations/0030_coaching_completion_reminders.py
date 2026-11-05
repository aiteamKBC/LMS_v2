import django.db.models.deletion
from django.db import migrations,models


class Migration(migrations.Migration):
    dependencies=[('coach_api','0029_coaching_calendar_index')]
    operations=[
        migrations.CreateModel(name='CoachingCompletionSession',fields=[
            ('key',models.CharField(max_length=64,primary_key=True,serialize=False)),
            ('component_id',models.BigIntegerField(db_index=True)),
            ('source_meeting_id',models.CharField(max_length=64)),
            ('owner_email',models.EmailField(db_index=True,max_length=320)),
            ('learner_name',models.CharField(max_length=255)),('learner_email',models.EmailField(max_length=320)),('family',models.CharField(max_length=3)),
            ('event_id',models.CharField(max_length=1024)),('starts_at',models.DateTimeField()),('ends_at',models.DateTimeField()),
            ('state',models.CharField(max_length=32)),('source_status',models.CharField(max_length=64)),
            ('source_updated_at',models.DateTimeField()),('checked_at',models.DateTimeField()),
        ],options={'db_table':'Coach"."coaching_completion_session',
            'indexes':[models.Index(fields=['state','ends_at'],name='coach_completion_due'),
                models.Index(fields=['owner_email','starts_at'],name='coach_completion_occurrence')]}),
        migrations.CreateModel(name='CoachingCompletionDigest',fields=[
            ('id',models.BigAutoField(auto_created=True,primary_key=True,serialize=False,verbose_name='ID')),
            ('owner_email',models.EmailField(max_length=320)),('day',models.DateField()),
            ('state',models.CharField(default='sending',max_length=16)),('created_at',models.DateTimeField()),
            ('sent_at',models.DateTimeField(null=True)),
        ],options={'db_table':'Coach"."coaching_completion_digest','constraints':[
            models.UniqueConstraint(fields=('owner_email','day'),name='coach_completion_digest_once')]}),
        migrations.CreateModel(name='CoachingCompletionReminder',fields=[
            ('id',models.BigAutoField(auto_created=True,primary_key=True,serialize=False,verbose_name='ID')),
            ('stage',models.PositiveSmallIntegerField()),('due_at',models.DateTimeField()),
            ('read_at',models.DateTimeField(null=True)),('dismissed_at',models.DateTimeField(null=True)),
            ('cancelled_at',models.DateTimeField(null=True)),
            ('session',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,related_name='reminders',to='coach_api.coachingcompletionsession')),
            ('digest',models.ForeignKey(null=True,on_delete=django.db.models.deletion.PROTECT,related_name='reminders',to='coach_api.coachingcompletiondigest')),
        ],options={'db_table':'Coach"."coaching_completion_reminder','constraints':[
            models.UniqueConstraint(fields=('session','stage'),name='coach_completion_stage_once')],
            'indexes':[models.Index(fields=['cancelled_at','due_at'],name='coach_completion_inbox')]}),
    ]
