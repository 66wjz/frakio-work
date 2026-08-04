import { createHash } from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function sourceVersion(entry = {}) {
  return String(entry.updatedAt || entry.hash || digest(entry.content ?? entry.fact ?? entry).slice(0, 20));
}

function sourceIds(packet = {}) {
  return Array.from(new Set([
    ...(packet.memory || []).map((entry) => `memory:${entry.id}:${sourceVersion(entry)}`),
    ...(packet.personalKnowledge || []).map((entry) => `personal:${packet.personalVault?.id || 'personal'}:${entry.relativePath}:${sourceVersion(entry)}`),
    ...(packet.projectKnowledge || packet.knowledge || []).map((entry) => `project:${packet.vault?.id || 'project'}:${entry.relativePath}:${sourceVersion(entry)}`),
    ...(packet.projectRules || []).map((entry) => `rule:${packet.vault?.id || 'project'}:${entry.relativePath}:${sourceVersion(entry)}`),
    ...(packet.handoff?.recentConversation || []).map((entry) => `message:${entry.messageId || ''}`),
    ...(packet.handoff?.acceptedDecisions || []).map((entry) => `decision:${entry.messageId || ''}`),
  ].filter(Boolean))).sort();
}

function deltaPacket(packet, previousIds) {
  const include = (prefix, id) => !previousIds.has(`${prefix}${id}`);
  return {
    ...packet,
    memory: (packet.memory || []).filter((entry) => include('memory:', `${entry.id}:${sourceVersion(entry)}`)),
    personalKnowledge: (packet.personalKnowledge || []).filter((entry) => include('personal:', `${packet.personalVault?.id || 'personal'}:${entry.relativePath}:${sourceVersion(entry)}`)),
    projectKnowledge: (packet.projectKnowledge || packet.knowledge || []).filter((entry) => include('project:', `${packet.vault?.id || 'project'}:${entry.relativePath}:${sourceVersion(entry)}`)),
    knowledge: (packet.projectKnowledge || packet.knowledge || []).filter((entry) => include('project:', `${packet.vault?.id || 'project'}:${entry.relativePath}:${sourceVersion(entry)}`)),
    projectRules: (packet.projectRules || []).filter((entry) => include('rule:', `${packet.vault?.id || 'project'}:${entry.relativePath}:${sourceVersion(entry)}`)),
    handoff: {
      ...(packet.handoff || {}),
      recentConversation: (packet.handoff?.recentConversation || []).filter((entry) => include('message:', entry.messageId || '')),
      acceptedDecisions: (packet.handoff?.acceptedDecisions || []).filter((entry) => include('decision:', entry.messageId || '')),
    },
  };
}

export function compileContextDelta(packet = {}, session = null, { profileRevision = '', forceFull = false } = {}) {
  const ids = sourceIds(packet);
  const packetHash = digest({
    profileRevision,
    ids,
    memory: (packet.memory || []).map((entry) => [entry.id, entry.updatedAt || '', entry.fact]),
    personalKnowledge: packet.personalKnowledge || [],
    projectKnowledge: packet.projectKnowledge || packet.knowledge || [],
    projectRules: packet.projectRules || [],
    handoff: { ...(packet.handoff || {}), createdAt: undefined },
    delivery: packet.delivery || null,
  });
  const previous = String(session?.contextWatermark || session?.metadata?.contextWatermark || '');
  const changed = forceFull || !previous || previous !== packetHash || session?.profileRevision !== profileRevision;
  const full = forceFull || !previous;
  const previousIds = new Set(session?.metadata?.contextSourceIds || []);
  return {
    fromWatermark: previous,
    toWatermark: packetHash,
    changed,
    hash: packetHash,
    sourceIds: ids,
    packet: changed ? full ? packet : deltaPacket(packet, previousIds) : {},
    full,
  };
}

export function contextPacketForAdapter(delta, originalPacket = {}) {
  if (!delta?.changed) return { contextDelta: { ...delta, packet: undefined }, memory: [], personalKnowledge: [], projectKnowledge: [], projectRules: [], handoff: originalPacket.handoff || {} };
  return { ...(delta.packet || originalPacket), contextDelta: { ...delta, packet: undefined } };
}
