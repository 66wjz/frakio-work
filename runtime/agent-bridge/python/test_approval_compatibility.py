from __future__ import annotations

import queue
import threading
import time
import unittest

from bridge_pool import AgentPool


class ApprovalCompatibilityTests(unittest.TestCase):
    def _pool(self) -> tuple[AgentPool, list[dict]]:
        pool = AgentPool.__new__(AgentPool)
        pool._lock = threading.RLock()
        pool._approval_requests = {}
        pool._gateway_approval_requests = {}
        pool._gateway_approval_pattern_keys = {}
        pool._approval_allowed_choices = {}
        events: list[dict] = []
        pool._append_event = lambda _session_id, event: events.append(event)
        return pool, events

    def _wait_for_request(self, events: list[dict]) -> dict:
        deadline = time.time() + 1
        while time.time() < deadline:
            if events:
                return events[0]
            time.sleep(0.005)
        self.fail("approval request was not emitted")

    def test_smart_deny_only_accepts_once_or_deny(self) -> None:
        pool, events = self._pool()
        result: queue.Queue[str] = queue.Queue()

        def run_callback() -> None:
            result.put(pool._approval_callback("session-1")(
                "dangerous command",
                "Smart reviewer denied this command",
                allow_permanent=True,
                smart_denied=True,
            ))

        worker = threading.Thread(target=run_callback, daemon=True)
        worker.start()
        request = self._wait_for_request(events)
        self.assertEqual(request["choices"], ["once", "deny"])
        self.assertFalse(request["allow_permanent"])
        self.assertTrue(request["smart_denied"])

        invalid = pool.respond_approval(request["approval_id"], "always")
        self.assertFalse(invalid["resolved"])
        self.assertEqual(invalid["allowed_choices"], ["deny", "once"])

        accepted = pool.respond_approval(request["approval_id"], "once")
        self.assertTrue(accepted["resolved"])
        worker.join(timeout=1)
        self.assertEqual(result.get_nowait(), "once")

    def test_non_permanent_manual_request_hides_always(self) -> None:
        pool, events = self._pool()
        result: queue.Queue[str] = queue.Queue()
        worker = threading.Thread(
            target=lambda: result.put(pool._approval_callback("session-2")(
                "command",
                "manual approval",
                allow_permanent=False,
            )),
            daemon=True,
        )
        worker.start()
        request = self._wait_for_request(events)
        self.assertEqual(request["choices"], ["once", "session", "deny"])
        self.assertFalse(request["allow_permanent"])
        pool.respond_approval(request["approval_id"], "deny")
        worker.join(timeout=1)
        self.assertEqual(result.get_nowait(), "deny")

    def test_gateway_smart_deny_preserves_upstream_choice_contract(self) -> None:
        pool, events = self._pool()
        pool._gateway_approval_notify("gateway-session")({
            "command": "dangerous command",
            "description": "owner override",
            "allow_permanent": False,
            "smart_denied": True,
            "choices": ["once", "deny"],
        })
        request = self._wait_for_request(events)
        self.assertEqual(request["choices"], ["once", "deny"])
        self.assertFalse(request["allow_permanent"])
        self.assertTrue(request["smart_denied"])


if __name__ == "__main__":
    unittest.main()
