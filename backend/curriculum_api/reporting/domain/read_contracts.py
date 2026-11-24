"""Concrete reporting / domain / read contracts capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""



KSB_TYPE_FAMILIES = (
    ('knowledge', 'K', 'Knowledge'),
    ('skill', 'S', 'Skills'),
    ('behaviour', 'B', 'Behaviours'),
)



SUPPORTED_KSB_SOURCE_TYPES = {'standard', 'framework'}
