"""A small JSON Schema validator for tool arguments.

``jsonschema`` is not a dependency of this project, so tool input schemas are
limited to the keywords below, and ``check_schema`` refuses any other keyword when
a tool is registered -- a schema can never silently promise a check that is not
made. Messages are written for the person reading the tool error, not for a
developer.
"""

TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    # bool is an int in Python; JSON booleans are not numbers.
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}
TYPE_WORDS = {
    "object": "an object", "array": "a list", "string": "text", "integer": "a whole number",
    "number": "a number", "boolean": "true or false", "null": "empty",
}
KEYWORDS = {
    "type", "properties", "required", "additionalProperties", "enum", "const", "items",
    "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems",
    # Annotations only.
    "description", "title", "default", "examples", "$schema",
}


class SchemaError(Exception):
    """The schema itself uses something this validator does not check."""


def check_schema(schema, path="schema"):
    if not isinstance(schema, dict):
        raise SchemaError(f"{path} must be an object")
    unknown = set(schema) - KEYWORDS
    if unknown:
        raise SchemaError(f"{path} uses unsupported keyword(s): {', '.join(sorted(unknown))}")
    types = schema.get("type")
    for name in ([types] if isinstance(types, str) else types or []):
        if name not in TYPES:
            raise SchemaError(f"{path} has unknown type {name!r}")
    for key, sub in (schema.get("properties") or {}).items():
        check_schema(sub, f"{path}.properties.{key}")
    if isinstance(schema.get("additionalProperties"), dict):
        check_schema(schema["additionalProperties"], f"{path}.additionalProperties")
    if "items" in schema:
        check_schema(schema["items"], f"{path}.items")


def _label(path):
    return f"'{path}'" if path else "The input"


def validate(value, schema, path=""):
    """The first problem with ``value`` as a readable sentence, or None."""
    types = schema.get("type")
    if types is not None:
        names = [types] if isinstance(types, str) else list(types)
        if not any(TYPES[name](value) for name in names):
            return f"{_label(path)} must be {' or '.join(TYPE_WORDS[n] for n in names)}."
    if "const" in schema and value != schema["const"]:
        return f"{_label(path)} must be {schema['const']!r}."
    if "enum" in schema and value not in schema["enum"]:
        return f"{_label(path)} must be one of: {', '.join(map(str, schema['enum']))}."
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            return f"{_label(path)} must be at least {schema['minLength']} character(s)."
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            return f"{_label(path)} must be at most {schema['maxLength']} characters."
    if TYPES["number"](value):
        if "minimum" in schema and value < schema["minimum"]:
            return f"{_label(path)} must be at least {schema['minimum']}."
        if "maximum" in schema and value > schema["maximum"]:
            return f"{_label(path)} must be at most {schema['maximum']}."
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            return f"{_label(path)} needs at least {schema['minItems']} item(s)."
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            return f"{_label(path)} can have at most {schema['maxItems']} items."
        if "items" in schema:
            for index, item in enumerate(value):
                problem = validate(item, schema["items"], f"{path}[{index}]")
                if problem:
                    return problem
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                return f"'{f'{path}.' if path else ''}{key}' is required."
        properties = schema.get("properties") or {}
        extra = schema.get("additionalProperties", True)
        for key, item in value.items():
            child = f"{path}.{key}" if path else key
            if key in properties:
                problem = validate(item, properties[key], child)
            elif extra is False:
                problem = f"'{child}' is not a recognised input."
            elif isinstance(extra, dict):
                problem = validate(item, extra, child)
            else:
                problem = None
            if problem:
                return problem
    return None
