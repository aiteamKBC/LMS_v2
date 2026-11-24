"""Pure catalogue values; no framework, storage or providers."""

from curriculum_api.catalogue.domain.read_contracts import RETIRED_COMPONENT_TYPES


def normalise_component_type(value):
    return str(value or '').replace('-', '_')


def is_retired_component_type(value):
    return normalise_component_type(value) in RETIRED_COMPONENT_TYPES
