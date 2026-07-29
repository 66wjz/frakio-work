import unittest

from rich_tool_metadata import enrich_tool_definitions, is_metadata_schema_error, strip_tool_metadata


class RichToolMetadataTests(unittest.TestCase):
    def test_enriches_strict_and_zero_argument_schema_without_mutating_source(self):
        source = [{"type": "function", "function": {"name": "ping", "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False}}}]
        enriched = enrich_tool_definitions(source)
        parameters = enriched[0]["function"]["parameters"]
        self.assertEqual(source[0]["function"]["parameters"]["properties"], {})
        self.assertIn("_displayName", parameters["properties"])
        self.assertIn("_intent", parameters["properties"])
        self.assertEqual(parameters["required"], ["_displayName", "_intent"])

    def test_strips_metadata_before_execution(self):
        cleaned, metadata = strip_tool_metadata({"path": "a.txt", "_displayName": "读取文件", "_intent": "查看配置"})
        self.assertEqual(cleaned, {"path": "a.txt"})
        self.assertEqual(metadata, {"display_name": "读取文件", "intent": "查看配置"})

    def test_setting_off_keeps_schema_unchanged(self):
        source = [{"type": "function", "function": {"name": "ping", "parameters": {"type": "object", "properties": {}}}}]
        self.assertEqual(enrich_tool_definitions(source, False), source)

    def test_only_schema_validation_errors_trigger_fallback(self):
        self.assertTrue(is_metadata_schema_error("Invalid schema: unknown required property _intent"))
        self.assertFalse(is_metadata_schema_error("401 unauthorized"))


if __name__ == "__main__":
    unittest.main()
