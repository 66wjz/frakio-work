import { createHash } from 'node:crypto';

function text(value) {
  return String(value || '').trim();
}

export function createRuntimeExecutionRealm({ runtimeId, runtimeBinding, modelRoute = {}, agentId, skillSetRevision, runtimeConfigRevision = '' } = {}) {
  const realm = {
    runtimeId: text(runtimeId),
    runtimeBuildId: text(runtimeBinding?.runtimeBuildId),
    providerId: text(modelRoute.providerId),
    providerCredentialRevision: text(modelRoute.providerCredentialRevision || modelRoute.credentialRevision),
    modelRouteRevision: text(modelRoute.routeRevision),
    harnessApiMode: text(modelRoute.harnessApiMode),
    upstreamApiMode: text(modelRoute.upstreamApiMode || modelRoute.apiMode),
    bridgeId: text(modelRoute.bridgeId),
    capabilities: modelRoute.capabilities || {},
    degradations: Array.isArray(modelRoute.degradations) ? modelRoute.degradations : [],
    agentId: text(agentId),
    skillSetRevision: text(skillSetRevision),
    runtimeConfigRevision: text(runtimeConfigRevision),
  };
  const revision = createHash('sha256').update(JSON.stringify(realm)).digest('hex');
  return { id: `realm_${revision.slice(0, 24)}`, revision, ...realm };
}
