from __future__ import annotations

import threading
import types
import unittest
from unittest import mock

from bridge_pool import AgentPool
from hermes_bridge import AgentPool as FacadeAgentPool


def _session(*, running: bool = False):
    return types.SimpleNamespace(
        running=running,
        last_used_at=0.0,
        config={
            "profile": "default",
            "model": "gpt-test",
            "requested_provider": "custom:relay",
            "provider": "custom",
            "runtime_revision": "revision-1",
        },
    )


class ProviderRuntimeRefreshTests(unittest.TestCase):
    def _pool(self, session):
        pool = AgentPool.__new__(AgentPool)
        pool._lock = threading.RLock()
        pool._sessions = {"session": session}
        return pool

    def test_requested_custom_provider_identity_does_not_trigger_switch(self):
        session = _session()
        pool = self._pool(session)
        resolved = pool.get_or_create(
            "session",
            profile="default",
            model="gpt-test",
            provider="custom:relay",
            runtime_revision="revision-1",
        )
        self.assertIs(resolved, session)

    def test_runtime_revision_change_rebuilds_an_idle_session(self):
        session = _session()
        pool = self._pool(session)

        def destroy(_session_id):
            raise RuntimeError("rebuild requested")

        pool._destroy_session = destroy
        with self.assertRaisesRegex(RuntimeError, "rebuild requested"):
            pool.get_or_create(
                "session",
                profile="default",
                model="gpt-test",
                provider="custom:relay",
                runtime_revision="revision-2",
            )

    def test_facade_forwards_runtime_revision(self):
        session = _session()
        facade = FacadeAgentPool.__new__(FacadeAgentPool)
        with mock.patch.object(AgentPool, "get_or_create", return_value=session) as get_or_create:
            resolved = facade.get_or_create(
                "session",
                profile="default",
                model="gpt-test",
                provider="custom:relay",
                runtime_revision="revision-2",
            )
        self.assertIs(resolved, session)
        get_or_create.assert_called_once_with(
            "session",
            profile="default",
            model="gpt-test",
            provider="custom:relay",
            runtime_revision="revision-2",
        )


if __name__ == "__main__":
    unittest.main()
