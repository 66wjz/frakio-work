from __future__ import annotations

import threading
import unittest

from bridge_pool import AgentPool


class ToolEventTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pool = object.__new__(AgentPool)
        self.pool._lock = threading.RLock()
        self.pool._tool_progress_events = {}
        self.events = []
        self.pool._append_event = lambda session_id, event: self.events.append(event)

    def test_progress_metadata_enriches_canonical_tool_events(self) -> None:
        progress = self.pool._tool_progress_callback("session-1")
        progress("tool.started", "read_file", "src/main.tsx", {"path": "src/main.tsx"})
        self.pool._tool_start_callback("session-1")("call-1", "read_file", {"path": "src/main.tsx"})
        progress("tool.completed", "read_file", "loaded 42 lines", {"path": "src/main.tsx"}, duration=0.35, is_error=False)
        self.pool._tool_complete_callback("session-1")("call-1", "read_file", {"path": "src/main.tsx"}, "full output")

        self.assertEqual(self.events[0]["tool_call_id"], "call-1")
        self.assertEqual(self.events[0]["args_preview"], "src/main.tsx")
        self.assertEqual(self.events[1]["result_preview"], "loaded 42 lines")
        self.assertEqual(self.events[1]["duration"], 0.35)
        self.assertFalse(self.events[1]["is_error"])

    def test_parallel_same_tool_progress_uses_fifo_order(self) -> None:
        progress = self.pool._tool_progress_callback("session-1")
        progress("tool.started", "read_file", "one")
        progress("tool.started", "read_file", "two")
        start = self.pool._tool_start_callback("session-1")
        start("call-1", "read_file", {})
        start("call-2", "read_file", {})
        self.assertEqual([event["args_preview"] for event in self.events], ["one", "two"])


if __name__ == "__main__":
    unittest.main()
