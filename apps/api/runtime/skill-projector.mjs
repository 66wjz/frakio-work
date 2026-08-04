import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function revision(skills) {
  return createHash('sha256').update(JSON.stringify(skills.map((skill) => [skill.id, skill.version, skill.contentHash]).sort())).digest('hex');
}

export function resolveSkillSet({ taskSkills = [], agentSkills = [], workspaceSkills = [], teamSkills = [] } = {}) {
  const selected = new Map();
  for (const collection of [teamSkills, workspaceSkills, agentSkills, taskSkills]) {
    const withinScope = new Map();
    for (const skill of collection) {
      if (!skill?.id) continue;
      const duplicate = withinScope.get(skill.id);
      if (duplicate && duplicate.contentHash !== skill.contentHash) {
        const error = new Error(`Conflicting Skill content for ${skill.id}.`);
        error.code = 'SKILL_CONTENT_CONFLICT';
        throw error;
      }
      withinScope.set(skill.id, skill);
    }
    for (const skill of withinScope.values()) selected.set(skill.id, skill);
  }
  const skills = Array.from(selected.values()).sort((a, b) => a.id.localeCompare(b.id));
  return { skills, revision: revision(skills) };
}

export function createSkillProjector({ store, adapters = new Map() }) {
  return {
    async apply({ runtimeId, agentId, sessionId, skillSet, requiredSkillIds = [] }) {
      const adapter = adapters.get(runtimeId);
      const receipts = [];
      const hostInstructions = [];
      const missing = requiredSkillIds.filter((skillId) => !skillSet.skills.some((skill) => skill.id === skillId));
      if (missing.length) {
        const error = new Error(`Required Skills are not registered: ${missing.join(', ')}`);
        error.code = 'REQUIRED_SKILL_NOT_FOUND';
        error.details = { skillIds: missing };
        throw error;
      }
      if (!skillSet.skills.length) return { revision: skillSet.revision, receipts, hostInstructions };
      if (!adapter?.applySkills) {
        for (const skill of skillSet.skills) {
          if (requiredSkillIds.includes(skill.id)) {
            const content = await readFile(path.join(skill.entryPath, 'SKILL.md'), 'utf8').catch(() => '');
            if (content) {
              hostInstructions.push({ skillId: skill.id, version: skill.version, content });
              receipts.push(store.putSkillApplication({ skill, runtimeId, agentId, sessionId, status: 'applied', loadMethod: 'host_instruction', error: '' }));
              continue;
            }
          }
          receipts.push(store.putSkillApplication({ skill, runtimeId, agentId, sessionId, status: 'available', loadMethod: 'unsupported', error: '' }));
        }
      } else {
        const result = await adapter.applySkills({ runtimeId, agentId, sessionId, skills: skillSet.skills });
        const adapterUnsupported = result?.status === 'unsupported';
        for (const skill of skillSet.skills) {
          const applied = result?.applications?.find((item) => item.skillId === skill.id) || {};
          let status = adapterUnsupported
            ? requiredSkillIds.includes(skill.id) ? 'incompatible' : 'available'
            : applied.status || 'failed';
          let loadMethod = adapterUnsupported ? 'unsupported' : applied.loadMethod || '';
          let applicationError = adapterUnsupported && status === 'incompatible' ? 'Runtime does not support Skill projection.' : applied.error || '';
          if (requiredSkillIds.includes(skill.id) && !['applied', 'projecting'].includes(status)) {
            const content = await readFile(path.join(skill.entryPath, 'SKILL.md'), 'utf8').catch(() => '');
            if (content) {
              hostInstructions.push({ skillId: skill.id, version: skill.version, content });
              status = 'applied';
              loadMethod = 'host_instruction';
              applicationError = '';
            }
          }
          receipts.push(store.putSkillApplication({
            skill, runtimeId, agentId, sessionId, status,
            loadMethod,
            error: applicationError,
          }));
        }
      }
      const blocked = receipts.filter((receipt) => requiredSkillIds.includes(receipt.skillId) && !['applied', 'projecting'].includes(receipt.status));
      if (blocked.length) {
        const error = new Error(`Required Skills are not active: ${blocked.map((item) => item.skillId).join(', ')}`);
        error.code = 'REQUIRED_SKILL_NOT_APPLIED';
        error.details = { receipts: blocked };
        throw error;
      }
      return { revision: skillSet.revision, receipts, hostInstructions };
    },
  };
}
