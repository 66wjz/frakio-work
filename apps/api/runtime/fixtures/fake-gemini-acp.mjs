import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);

new AgentSideConnection((connection) => ({
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: true } },
      agentInfo: { name: 'fake-gemini', title: 'Fake Gemini ACP', version: '1.0.0' },
      authMethods: [],
    };
  },
  async authenticate() {
    return {};
  },
  async newSession() {
    return { sessionId: 'gemini-session-1' };
  },
  async loadSession() {
    return {};
  },
  async prompt(params) {
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Gemini ready' } },
    });
    return { stopReason: 'end_turn' };
  },
  async cancel() {},
  async setSessionMode() {
    return {};
  },
  async setSessionConfigOption() {
    return { configOptions: [] };
  },
  async unstable_setSessionModel() {
    return {};
  },
}), stream);
