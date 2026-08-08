"""Canonical option lists for enrolment users.

These are the authoritative server-side choices. The frontend mirrors them in its
create form; the API validates against them so bad values can't be written even if
a client bypasses the UI.
"""

STATUS_CHOICES = [
    "FullUser",
    "Invited",
    "Prospect",
    "Expired",
    "Cancelled",
    "Archived",
]

TYPE_CHOICES = [
    "User",
    "Employer",
    "Referrer",
    "Admin",
    "Caseowner",
]

# Which kind of learner a row in enrolment."Created_users" is. Both kinds share
# that one table, and this column is the discriminator.
LEARNER_TYPE_CHOICES = [
    "apprenticeship",
    "commercial",
]

# Staff positions, asked for at the foot of the "Create admin" form and stored on
# enrolment."Staff_users"."Position". Validated in the API rather than by a DB
# check constraint, so this list can grow without DDL.
POSITION_CHOICES = [
    "Caseowner",
    "Admin",
    "Enrolment",
    "Curriculum team",
    "Operations team",
]

# Organisation record status, from the organisation form's Status dropdown.
# Validated in the API rather than by a DB check constraint, as above.
ORGANISATION_STATUS_CHOICES = [
    "Confirmed",
    "Opportunity",
    "Archived",
]

# Whether the organisation pays the apprenticeship levy. "Not selected" is the
# form's own default and is stored as-is rather than as NULL, so an untouched
# dropdown is distinguishable from a deliberate blank.
LEVY_PAYER_CHOICES = [
    "Not selected",
    "Yes",
    "No",
]

# The organisation's health & safety risk rating, not a pass/fail outcome.
HEALTH_SAFETY_CHOICES = [
    "Not known",
    "Low",
    "Medium",
    "High",
]

# What kind of group an organisation is. The Employer Group picker shows this in
# its own column; every row in the reference screenshots is an Employer.
ORGANISATION_GROUP_TYPE_CHOICES = [
    "Employer",
    "Provider",
    "Sub-contractor",
    "Other",
]

# The programme lifecycle, in the order a learner moves through it. Only these
# values can be written; rows created before this list was trimmed may still
# hold older statuses, which display as-is but can no longer be selected.
PROGRAMME_STATUS_CHOICES = [
    # Account exists but the learner hasn't been put into the enrolment flow
    # yet. Also the display fallback when no status has been set at all.
    "Fresh user",
    # Learner is filling in their own enrolment wizard. While a learner sits at
    # this status their /workspace/learner landing page redirects them to
    # /learner/onboarding instead of the normal overview.
    "Onboarding",
    "Delivery",
    "Ready to enrol",
    "Active",
    "Withdrawn",
    "On break",
    "Completed",
]

# Shown for a learner whose programme status has never been set.
DEFAULT_PROGRAMME_STATUS = "Fresh user"

# Reached automatically once all three onboarding reviews are signed by every
# party (see learning_plan.promote_to_delivery_if_ready). A learner at this
# status has a learning plan to build, so the users table offers it there.
DELIVERY_PROGRAMME_STATUS = "Delivery"
