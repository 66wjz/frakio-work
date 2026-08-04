from __future__ import annotations

import contextlib
import sys
import types
import unittest
from unittest.mock import patch

from bridge_broker import BridgeBroker
from bridge_pool import AgentPool


class MemoryReviewTests(unittest.TestCase):
    def test_broker_routes_review_to_requested_profile(self) -> None:
        broker = BridgeBroker("ipc:///tmp/frakio-memory-review-test.sock")
        request = {"action": "memory_review", "profile": "iris", "input": "{}"}
        with patch.object(broker, "_forward", return_value={"output": "{\"candidates\":[]}"}) as forward:
            result = broker.handle(request)
        self.assertEqual(result, {"output": "{\"candidates\":[]}"})
        forward.assert_called_once_with("iris", request, "iris")

    def test_review_is_stateless_low_temperature_and_uses_explicit_runtime(self) -> None:
        calls = []
        agent_module = types.ModuleType("agent")
        auxiliary_module = types.ModuleType("agent.auxiliary_client")

        def call_llm(**kwargs):
            calls.append(kwargs)
            return {"content": '{"candidates":[]}'}

        auxiliary_module.call_llm = call_llm
        auxiliary_module.extract_content_or_reasoning = lambda response: response["content"]
        previous_agent = sys.modules.get("agent")
        previous_auxiliary = sys.modules.get("agent.auxiliary_client")
        sys.modules["agent"] = agent_module
        sys.modules["agent.auxiliary_client"] = auxiliary_module
        try:
            runtime = {"provider": "openai", "model": "test-model", "request_overrides": {"seed": 7}}
            pool = AgentPool()
            with (
                patch("bridge_pool._profile_env", return_value=contextlib.nullcontext()),
                patch("bridge_pool._refresh_worker_profile_env"),
            ):
                result = pool.review_memory("strict json", "input", "iris", 60, runtime)
            self.assertEqual(result, {"output": '{"candidates":[]}'})
            self.assertEqual(calls[0]["task"], "memory_review")
            self.assertEqual(calls[0]["temperature"], 0.1)
            self.assertEqual(calls[0]["main_runtime"], {"provider": "openai", "model": "test-model"})
            self.assertEqual(calls[0]["extra_body"], {"seed": 7})
            self.assertEqual(pool.list_sessions()["sessions"], [])
        finally:
            if previous_agent is None:
                sys.modules.pop("agent", None)
            else:
                sys.modules["agent"] = previous_agent
            if previous_auxiliary is None:
                sys.modules.pop("agent.auxiliary_client", None)
            else:
                sys.modules["agent.auxiliary_client"] = previous_auxiliary


if __name__ == "__main__":
    unittest.main()
