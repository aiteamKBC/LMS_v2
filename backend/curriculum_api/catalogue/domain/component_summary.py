"""Publication and minute-rounding decisions for component summaries."""
import math




def js_round(value):
    """``Math.round`` exactly: halves go up, towards +infinity, never to even."""
    whole = math.floor(value)
    return whole + 1 if value - whole >= 0.5 else whole


def component_is_published(settings):
    """1 when component_builder_response() would report this row 'published', else 0."""
    return 1 if (settings.get('componentBuilderStatus') or 'draft') == 'published' else 0
