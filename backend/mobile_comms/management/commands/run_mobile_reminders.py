import json
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from mobile_comms.push import FcmSender
from mobile_comms.worker import tick

class Command(BaseCommand):
    help = "Reconcile LMS reminders once; dispatch only when explicitly enabled."
    def handle(self,*args,**options):
        if not getattr(settings,"KBC_MOBILE_COMMS_ENABLED",False):
            raise CommandError("Mobile communications are disabled.")
        # Linux advisory lock also covers manual invocations of this command.
        import fcntl
        with open(getattr(settings,"KBC_MOBILE_WORKER_LOCK","/run/kbc-mobile/reminders.lock"),"a") as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:return
            sender = FcmSender(settings.KBC_MOBILE_FCM_CREDENTIAL,settings.KBC_MOBILE_FCM_PROJECT) if settings.KBC_MOBILE_PUSH_ENABLED else None
            result=tick(sender)
            self.stdout.write(json.dumps(result))
            if result["sourceErrors"]:raise CommandError("One or more LMS reminder sources could not be refreshed; see sourceErrors count.")
