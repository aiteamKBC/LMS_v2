"""No Django admin registrations for the login models — deliberately.

Django's admin runs on the `default` database and authenticates against
`django.contrib.auth`, which is a different identity system from the one these
models implement. Registering them here would put password hashes, session
tokens and invitation tokens behind a second, unrelated login, and give any
Django staff user the ability to edit them.

Account management belongs in the platform's own console, behind
`login.permissions.require_role`, where the rules in `login.services` apply —
notably that only an administrator can create another administrator.
"""
