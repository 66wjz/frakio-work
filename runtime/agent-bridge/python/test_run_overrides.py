from __future__ import annotations

import sys
import types
import unittest

from bridge_pool import _plan_tool_allowed, _safe_plan_terminal_command, _temporary_run_overrides


class _Agent:
    def __init__(self) -> None:
        self.reasoning_config = {"effort": "default"}
        self.service_tier = "auto"
        self.request_overrides = {"existing": True, "speed": "old"}
        self.tools = ["read", "write"]


class RunOverrideTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_constants = sys.modules.get("hermes_constants")
        constants = types.ModuleType("hermes_constants")
        constants.parse_reasoning_effort = lambda effort: {"effort": effort}
        sys.modules["hermes_constants"] = constants

    def tearDown(self) -> None:
        if self.original_constants is None:
            sys.modules.pop("hermes_constants", None)
        else:
            sys.modules["hermes_constants"] = self.original_constants

    def test_openai_overrides_are_temporary(self) -> None:
        agent = _Agent()
        with _temporary_run_overrides(agent, "high", "fast", "openai_priority"):
            self.assertEqual(agent.reasoning_config, {"effort": "high"})
            self.assertEqual(agent.service_tier, "priority")
            self.assertEqual(agent.request_overrides, {"existing": True, "service_tier": "priority"})
        self.assertEqual(agent.reasoning_config, {"effort": "default"})
        self.assertEqual(agent.service_tier, "auto")
        self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old"})

    def test_anthropic_overrides_restore_after_failure(self) -> None:
        agent = _Agent()
        with self.assertRaisesRegex(RuntimeError, "failed"):
            with _temporary_run_overrides(agent, "max", "fast", "anthropic_fast"):
                self.assertEqual(agent.request_overrides, {"existing": True, "speed": "fast"})
                raise RuntimeError("failed")
        self.assertEqual(agent.reasoning_config, {"effort": "default"})
        self.assertEqual(agent.service_tier, "auto")
        self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old"})

    def test_validated_runtime_overrides_are_temporary_and_protected(self) -> None:
        agent = _Agent()
        with _temporary_run_overrides(agent, runtime_overrides={
            "reasoning_config": {"effort": "ultra"},
            "service_tier": "priority",
            "request_overrides": {"temperature": 0.2, "authorization": "blocked", "stream": False},
        }):
            self.assertEqual(agent.reasoning_config, {"effort": "ultra"})
            self.assertEqual(agent.service_tier, "priority")
            self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old", "service_tier": "priority", "temperature": 0.2})
        self.assertEqual(agent.reasoning_config, {"effort": "default"})
        self.assertEqual(agent.service_tier, "auto")
        self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old"})

    def test_deepseek_thinking_stays_nested_in_extra_body(self) -> None:
        agent = _Agent()
        with _temporary_run_overrides(agent, runtime_overrides={
            "request_overrides": {
                "reasoning_effort": "max",
                "extra_body": {"thinking": {"type": "enabled"}},
            },
        }):
            self.assertNotIn("thinking", agent.request_overrides)
            self.assertEqual(agent.request_overrides["reasoning_effort"], "max")
            self.assertEqual(agent.request_overrides["extra_body"], {"thinking": {"type": "enabled"}})
        self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old"})

    def test_ephemeral_repair_can_temporarily_disable_tools(self) -> None:
        agent = _Agent()
        with _temporary_run_overrides(agent, runtime_overrides={"disable_tools": True}):
            self.assertEqual(agent.tools, [])
        self.assertEqual(agent.tools, ["read", "write"])

    def test_plan_guard_allows_only_read_tools_and_controlled_plan_tools(self) -> None:
        self.assertTrue(_plan_tool_allowed("read_file", {"path": "apps/api/server.mjs"}))
        self.assertTrue(_plan_tool_allowed("hermes_workbench_plan_submit", {"planId": "plan-1"}))
        self.assertTrue(_plan_tool_allowed(
            "mcp__hermes_workbench_use__hermes_workbench_plan_submit",
            {"planId": "plan-1"},
        ))
        self.assertTrue(_plan_tool_allowed(
            "mcp__hermes_workbench_api__hermes_workbench_api_catalog_get",
            {},
        ))
        self.assertFalse(_plan_tool_allowed("write_file", {"path": "apps/api/server.mjs"}))
        self.assertFalse(_plan_tool_allowed("execute_code", {"code": "print('write')"}))
        self.assertFalse(_plan_tool_allowed("hermes_workbench_collaboration_plan_publish", {}))
        self.assertFalse(_plan_tool_allowed("unknown_mcp_create", {}))
        self.assertFalse(_plan_tool_allowed(
            "mcp__untrusted_server__hermes_workbench_plan_submit",
            {"planId": "plan-1"},
        ))
        self.assertFalse(_plan_tool_allowed(
            "mcp__hermes_workbench_use__hermes_workbench_plan_submit__spoofed",
            {"planId": "plan-1"},
        ))

    def test_plan_guard_allows_get_only_workbench_api_requests(self) -> None:
        short_name = "hermes_workbench_api_request"
        prefixed_name = "mcp__hermes_workbench_api__hermes_workbench_api_request"
        self.assertTrue(_plan_tool_allowed(short_name, {"path": "/api/state"}))
        self.assertTrue(_plan_tool_allowed(prefixed_name, {"method": "GET", "path": "/api/state"}))
        self.assertTrue(_plan_tool_allowed(prefixed_name, {"method": "get", "path": "/api/state"}))
        self.assertFalse(_plan_tool_allowed(prefixed_name, {"method": "POST", "path": "/api/state"}))
        self.assertFalse(_plan_tool_allowed(prefixed_name, {"method": "PATCH", "path": "/api/state"}))

    def test_plan_guard_allows_browser_research_interactions(self) -> None:
        for tool_name in (
            "browser_navigate",
            "browser_snapshot",
            "browser_scroll",
            "browser_back",
            "browser_get_images",
            "browser_vision",
        ):
            self.assertTrue(_plan_tool_allowed(tool_name, {}), tool_name)
        for tool_name in (
            "browser_click",
            "browser_type",
            "browser_press",
            "browser_console",
        ):
            self.assertTrue(_plan_tool_allowed(tool_name, {"selector": "[aria-label='Search']"}), tool_name)
        self.assertFalse(_plan_tool_allowed("browser_click", {"selector": "button", "text": "发布"}))
        self.assertFalse(_plan_tool_allowed("browser_type", {"selector": "input[type=password]", "text": "secret"}))
        self.assertTrue(_plan_tool_allowed("browser_type", {"selector": "input[type=search]", "text": "how to publish safely"}))
        self.assertFalse(_plan_tool_allowed("browser_press", {"effect": "persistent_mutation", "key": "Enter"}))
        self.assertFalse(_plan_tool_allowed("browser_cdp", {}))

    def test_plan_terminal_allowlist_rejects_shell_composition_and_git_mutation(self) -> None:
        self.assertTrue(_safe_plan_terminal_command("pwd"))
        self.assertTrue(_safe_plan_terminal_command("rg -n planMode apps/api/server.mjs"))
        self.assertTrue(_safe_plan_terminal_command("node --check apps/api/server.mjs"))
        self.assertTrue(_safe_plan_terminal_command("find apps -name '*.mjs'"))
        self.assertTrue(_safe_plan_terminal_command("git status --short"))
        self.assertTrue(_safe_plan_terminal_command("git diff -- apps/api/server.mjs"))
        self.assertTrue(_safe_plan_terminal_command("git branch --show-current"))
        self.assertFalse(_safe_plan_terminal_command("git status | tee status.txt"))
        self.assertFalse(_safe_plan_terminal_command("git diff --output=changes.patch"))
        self.assertFalse(_safe_plan_terminal_command("git checkout -- apps/api/server.mjs"))
        self.assertFalse(_safe_plan_terminal_command("find apps -name '*.tmp' -delete"))
        self.assertFalse(_safe_plan_terminal_command("find apps -exec touch marker {} ;"))
        self.assertFalse(_safe_plan_terminal_command("node --check --require ./hook.mjs apps/api/server.mjs"))
        self.assertFalse(_safe_plan_terminal_command("python -c 'print(1)'"))


if __name__ == "__main__":
    unittest.main()
