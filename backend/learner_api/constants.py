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

PROGRAMME_STATUS_CHOICES = [
    "Ready to enrol",
    "On probation",
    "Active",
    "Non starter",
    "Under review",
    "On maternity break",
    "On illness break",
    "On other break",
    "Entered EPA",
    "Completed",
    "Withdrawn (w/o funding)",
    "Early Leaver (funded)",
    "Not Eligible",
    "Imported",
    "On a break",
    "Withdrawn",
    "Pending Change of Programme",
    "Did Not Attend",
    "Early Completer",
    "Left Employment Active",
    "In Work (Mandatory)",
    "Outcome",
    "Tracking",
    "In Work (Voluntary)",
]
