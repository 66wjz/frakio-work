import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const START = '<!-- FRAKIO_MANAGED_PROJECTION_START -->';
const END = '<!-- FRAKIO_MANAGED_PROJECTION_END -->';

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function managed(content, metadata) {
  return `${START}\n<!-- ${JSON.stringify(metadata)} -->\n${content.trim()}\n${END}\n`;
}

function merge(existing, block, authority) {
  if (authority) return block;
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}\\n?`, 'm');
  if (pattern.test(existing)) return existing.replace(pattern, block);
  return `${block}\n${String(existing || '').trim()}${existing.trim() ? '\n' : ''}`;
}

async function atomicWrite(target, content) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.frakio-${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
}

function userDocument(userProfile = {}, memories = []) {
  const rows = [
    '# User profile', '',
    userProfile.nickname ? `- Name: ${userProfile.nickname}` : '',
    userProfile.bio ? `- Bio: ${userProfile.bio}` : '',
    userProfile.occupation ? `- Occupation: ${userProfile.occupation}` : '',
    userProfile.hobbies ? `- Interests: ${userProfile.hobbies}` : '',
    '', '## Confirmed facts and preferences', '',
    ...memories.map((entry) => `- ${entry.fact}`),
  ];
  return rows.filter((row, index) => row || rows[index - 1] !== '').join('\n');
}

function memoryDocument(agent, memories = []) {
  return ['# Agent memory', '', agent.notes ? '## Maintainer notes' : '', agent.notes || '', memories.length ? '## Verified experience' : '', ...memories.map((entry) => `- ${entry.fact}`)].filter(Boolean).join('\n');
}

function soulDocument(agent) {
  return ['# Soul', '', agent.soul || 'Follow the Frakio Agent identity supplied at runtime.', '', '## Role', '', agent.role || 'Assistant', '', '## Responsibility', '', agent.scope || '', agent.communicationStyle ? '## Communication style' : '', agent.communicationStyle || ''].filter(Boolean).join('\n');
}

export function createHermesProjectionService({ store, profileDir, authorityMode = () => 'compat' }) {
  async function publish({ agent, userProfile = {}, force = false }) {
    if (!agent?.profileName) return null;
    const dir = await profileDir(agent.profileName);
    if (!dir) throw new Error(`Hermes Profile ${agent.profileName} does not exist.`);
    const userMemories = store.listMemory({ scope: 'user', subjectId: 'default', status: 'accepted', limit: 100 });
    const agentMemories = store.listMemory({ scope: 'agent', subjectId: agent.id, status: 'accepted', limit: 100 });
    const memoryRevision = store.memoryRevision();
    const agentRevision = String(agent.profileRevision || '');
    const generatedAt = new Date().toISOString();
    const metadata = { owner: 'frakio', agentId: agent.id, agentRevision, memoryRevision };
    const documents = {
      user: managed(userDocument(userProfile, userMemories), { ...metadata, kind: 'user' }),
      memory: managed(memoryDocument(agent, agentMemories), { ...metadata, kind: 'memory' }),
      soul: managed(soulDocument(agent), { ...metadata, kind: 'soul' }),
    };
    const authority = authorityMode() === 'authority';
    const contentHash = hash([authority ? 'authority' : 'compat', ...Object.values(documents)].join('\0'));
    const previous = store.getHermesProjection(agent.profileName);
    if (!force && previous?.contentHash === contentHash && previous.status === 'ready') return previous;
    const files = {
      user: path.join(dir, 'memories', 'USER.md'),
      memory: path.join(dir, 'memories', 'MEMORY.md'),
      soul: path.join(dir, 'SOUL.md'),
    };
    try {
      for (const key of Object.keys(files)) {
        const existing = await readFile(files[key], 'utf8').catch(() => '');
        await atomicWrite(files[key], merge(existing, documents[key], authority));
      }
      store.putMemoryEvent({ idempotencyKey: `projection:${agent.profileName}:${contentHash}`, type: 'projection.published', actorType: 'system', actorId: agent.id, payload: { profileName: agent.profileName, agentRevision, memoryRevision, contentHash } });
      return store.putHermesProjection({ profileName: agent.profileName, agentId: agent.id, agentRevision, memoryRevision, contentHash, files, status: 'ready', generatedAt });
    } catch (error) {
      store.putHermesProjection({ profileName: agent.profileName, agentId: agent.id, agentRevision, memoryRevision, contentHash, files, status: 'failed', error: String(error?.message || error), generatedAt });
      throw error;
    }
  }

  async function externalContent(profileName, kind) {
    const dir = await profileDir(profileName);
    if (!dir) throw new Error('Hermes Profile does not exist.');
    const file = kind === 'user' ? path.join(dir, 'memories', 'USER.md') : kind === 'memory' ? path.join(dir, 'memories', 'MEMORY.md') : path.join(dir, 'SOUL.md');
    const content = await readFile(file, 'utf8').catch(() => '');
    return content.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`, 'm'), '').trim();
  }

  return { publish, externalContent };
}
