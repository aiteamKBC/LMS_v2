"""The Required badge uses allocated curriculum time, never time spent."""
from decimal import Decimal
from math import isfinite


def has_required_hours(value):
    return (isinstance(value, (int, float, Decimal)) and not isinstance(value, bool)
            and isfinite(value) and value > 0)
