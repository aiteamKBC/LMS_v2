"""Map an existing catalogue reward; never create vouchers or fulfil claims."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction
from engagement_api.models import Reward, VoucherClaim
from engagement_api.shared_reward_setup import require_same_database, operator_reference

class Command(BaseCommand):
    help = "Configure an existing digital reward at 100 points per GBP; leaves stock unchanged unless explicitly supplied."

    def add_arguments(self, parser):
        parser.add_argument("--operator", required=True)
        parser.add_argument("--reward-id", required=True, type=int)
        parser.add_argument("--amount-gbp", required=True, type=int)
        parser.add_argument("--stock", type=int)
        parser.add_argument("--enable", action="store_true")

    def handle(self, *args, **options):
        require_same_database()
        operator_reference(options["operator"])
        reward_id, amount, stock = options["reward_id"], options["amount_gbp"], options.get("stock")
        if reward_id <= 0 or not 1 <= amount <= 100000 or (stock is not None and stock < 0):
            raise CommandError("Use positive IDs/denominations and non-negative stock.")
        with transaction.atomic(using="default"), connections["default"].cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ["engagement:shared-reward-setup"])
            reward = Reward.objects.select_for_update().filter(pk=reward_id).first()
            if reward is None or not reward.active or reward.delivery_type != "digital" or reward.points != amount * 100:
                raise CommandError("Select an existing active digital reward already priced at 100 points per GBP.")
            held = VoucherClaim.objects.filter(reward=reward,status__in=["pending","approved","fulfilled"]).count()
            if stock is not None:
                if stock < held:
                    raise CommandError("Stock cannot be less than already reserved or fulfilled claims.")
                reward.stock = stock
                reward.save(update_fields=["stock", "updated_at"])
            cursor.execute('SELECT reward_id,amount_gbp FROM "Engagement".shared_reward_voucher_options WHERE reward_id=%s OR amount_gbp=%s FOR UPDATE', [reward_id, amount])
            existing = cursor.fetchall()
            if any(row != (reward_id, amount) for row in existing):
                raise CommandError("That reward or denomination is already mapped differently.")
            cursor.execute('INSERT INTO "Engagement".shared_reward_voucher_options(reward_id,amount_gbp,enabled) VALUES(%s,%s,%s) ON CONFLICT(reward_id) DO UPDATE SET enabled=EXCLUDED.enabled',
                           [reward_id, amount, bool(options["enable"])])
        self.stdout.write("Existing voucher option " + ("enabled." if options["enable"] else "saved disabled.") + " No claim was created or fulfilled.")
