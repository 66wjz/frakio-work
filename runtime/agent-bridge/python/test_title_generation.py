from __future__ import annotations

import contextlib
import sys
import types
import unittest
from unittest.mock import patch

from bridge_broker import BridgeBroker
from bridge_pool import AgentPool


class TitleGenerationTests(unittest.TestCase):
    def test_broker_routes_title_generation_to_the_requested_profile(self) -> None:
        broker = BridgeBroker("ipc:///tmp/frakio-title-generation-test.sock")
        request = {"action": "title_generate", "profile": "iris", "transcript": "用户：优化标题"}
        with patch.object(broker, "_forward", return_value={"title": "优化标题"}) as forward:
            result = broker.handle(request)
        self.assertEqual(result, {"title": "优化标题"})
        forward.assert_called_once_with("iris", request, "iris")

    def test_title_generation_is_stateless_and_uses_auxiliary_task(self) -> None:
        calls = []
        agent_module = types.ModuleType("agent")
        oneshot_module = types.ModuleType("agent.oneshot")

        def run_oneshot(**kwargs):
            calls.append(kwargs)
            return "优化浮层与标题"

        oneshot_module.run_oneshot = run_oneshot
        previous_agent = sys.modules.get("agent")
        previous_oneshot = sys.modules.get("agent.oneshot")
        sys.modules["agent"] = agent_module
        sys.modules["agent.oneshot"] = oneshot_module
        try:
            pool = AgentPool()
            with (
                patch("bridge_pool._profile_env", return_value=contextlib.nullcontext()),
                patch("bridge_pool._refresh_worker_profile_env"),
            ):
                result = pool.generate_title("用户：优化菜单\n\n助手：开始检查", "iris")
            self.assertEqual(result, {"title": "优化浮层与标题"})
            self.assertEqual(calls[0]["task"], "title_generation")
            self.assertEqual(calls[0]["user_input"], "用户：优化菜单\n\n助手：开始检查")
            self.assertEqual(pool.list_sessions()["sessions"], [])
        finally:
            if previous_agent is None:
                sys.modules.pop("agent", None)
            else:
                sys.modules["agent"] = previous_agent
            if previous_oneshot is None:
                sys.modules.pop("agent.oneshot", None)
            else:
                sys.modules["agent.oneshot"] = previous_oneshot


if __name__ == "__main__":
    unittest.main()
