from __future__ import annotations

import copy
import re
from typing import Any

DISPLAY_NAME_KEY = "_displayName"
INTENT_KEY = "_intent"

_SCHEMA_ERROR = re.compile(
    r"(schema|additionalProperties|required|_displayName|_intent).*(invalid|unknown|unsupported|not allowed|validation)|"
    r"(invalid|unknown|unsupported|not allowed|validation).*(schema|additionalProperties|required|_displayName|_intent)",
    re.IGNORECASE | re.DOTALL,
)


def enrich_tool_definitions(tools: Any, enabled: bool = True) -> list[dict[str, Any]]:
    cloned = copy.deepcopy(tools) if isinstance(tools, list) else []
    if not enabled:
        return cloned
    for tool in cloned:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function") if isinstance(tool.get("function"), dict) else tool
        parameters = function.get("parameters") if isinstance(function, dict) else None
        if not isinstance(parameters, dict) or parameters.get("type", "object") != "object":
            continue
        properties = parameters.setdefault("properties", {})
        if not isinstance(properties, dict):
            continue
        properties[DISPLAY_NAME_KEY] = {
            "type": "string",
            "description": "A concise 2-4 word action name for the UI. Follow the current conversation language.",
        }
        properties[INTENT_KEY] = {
            "type": "string",
            "description": "One or two short sentences explaining what this tool call is trying to accomplish. Follow the current conversation language.",
        }
        required = parameters.setdefault("required", [])
        if isinstance(required, list):
            for key in (DISPLAY_NAME_KEY, INTENT_KEY):
                if key not in required:
                    required.append(key)
    return cloned


def strip_tool_metadata(args: Any) -> tuple[dict[str, Any], dict[str, str]]:
    cleaned = dict(args) if isinstance(args, dict) else {}
    metadata = {
        "display_name": str(cleaned.pop(DISPLAY_NAME_KEY, "") or "").strip()[:80],
        "intent": str(cleaned.pop(INTENT_KEY, "") or "").strip()[:280],
    }
    return cleaned, metadata


def is_metadata_schema_error(error: Any) -> bool:
    return bool(_SCHEMA_ERROR.search(str(error or "")))
