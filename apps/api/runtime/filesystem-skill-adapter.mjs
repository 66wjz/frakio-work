import { lstat, mkdir, readlink, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';

function safeName(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) throw new Error('Skill ID is not safe for projection.');
  return name;
}

async function sameLink(target, source) {
  const stat = await lstat(target).catch(() => null);
  if (!stat?.isSymbolicLink()) return false;
  const linked = await readlink(target).catch(() => '');
  const [resolvedLinked, resolvedSource] = await Promise.all([
    realpath(path.resolve(path.dirname(target), linked)).catch(() => path.resolve(path.dirname(target), linked)),
    realpath(source).catch(() => path.resolve(source)),
  ]);
  return resolvedLinked === resolvedSource;
}

export function createFilesystemSkillAdapter({ runtimeId, rootForAgent }) {
  return {
    skillHotReload: false,
    async applySkills({ agentId, skills }) {
      const root = await rootForAgent(agentId);
      await mkdir(root, { recursive: true });
      const applications = [];
      for (const skill of skills) {
        if (skill.compatibleRuntimeIds?.length && !skill.compatibleRuntimeIds.includes(runtimeId)) {
          applications.push({ skillId: skill.id, status: 'incompatible', loadMethod: 'filesystem_link', error: `Skill does not declare ${runtimeId} compatibility.` });
          continue;
        }
        const source = path.resolve(skill.entryPath || '');
        const sourceStat = await lstat(source).catch(() => null);
        if (!sourceStat?.isDirectory()) {
          applications.push({ skillId: skill.id, status: 'failed', loadMethod: 'filesystem_link', error: 'Skill source directory does not exist.' });
          continue;
        }
        const target = path.join(root, safeName(skill.id));
        const targetStat = await lstat(target).catch(() => null);
        if (targetStat) {
          applications.push(await sameLink(target, source)
            ? { skillId: skill.id, status: 'projecting', loadMethod: 'filesystem_link', error: '' }
            : { skillId: skill.id, status: 'failed', loadMethod: 'filesystem_link', error: 'A different Skill already occupies the projection path.' });
          continue;
        }
        try {
          await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
          applications.push({ skillId: skill.id, status: 'projecting', loadMethod: 'filesystem_link', error: '' });
        } catch (error) {
          applications.push({ skillId: skill.id, status: 'failed', loadMethod: 'filesystem_link', error: error.message || String(error) });
        }
      }
      return { applications };
    },
  };
}
