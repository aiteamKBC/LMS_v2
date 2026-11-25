"""Connection capabilities of Neon's transaction-pooled endpoints."""


def neon_transaction_pooler(host):
    host = str(host or '').strip().lower().rstrip('.')
    return host.endswith('.neon.tech') and host.split('.', 1)[0].endswith('-pooler')
