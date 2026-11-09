"""Catalogue pricing metadata only; never grants or restricts learner access."""
import re
from decimal import Decimal


API_FIELDS = ('isForSale', 'price', 'currency')


def pricing_payload(row):
    price = row.get('price')
    return {
        'isForSale': bool(row.get('is_for_sale', False)),
        'price': format(Decimal(str(price)), '.2f') if price is not None else None,
        'currency': row.get('currency') or 'GBP',
    }


def pricing_values(payload, stored):
    """Omitted values survive edits; explicitly disabling sale clears price."""
    enabled = payload.get('isForSale', stored.get('is_for_sale', False))
    currency = payload.get('currency', stored.get('currency') or 'GBP')
    if not isinstance(enabled, bool):
        raise ValueError('isForSale', 'Choose whether this course is available for sale.')
    if currency != 'GBP':
        raise ValueError('currency', 'Course prices must be in GBP.')
    value = payload.get('price', stored.get('price'))
    amount = None
    if enabled:
        text = str(value).strip()
        if len(text) > 16 or not re.fullmatch(r'[0-9]+(?:\.[0-9]{1,2})?', text):
            raise ValueError('price', 'Enter a positive GBP price with at most two decimal places.')
        amount = Decimal(text)
        if not Decimal('0') < amount <= Decimal('99999999.99'):
            raise ValueError('price', 'Price must be between GBP 0.01 and GBP 99,999,999.99.')
        amount = amount.quantize(Decimal('0.01'))
    return {'is_for_sale': enabled, 'price': amount, 'currency': currency}
