import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FRAKIO_SERVICE_PROTOCOL = 1;

export function servicePaths(home) {
  const runtime = path.join(home, 'runtime');
  return {
    descriptor: path.join(runtime, 'service.json'),
    lock: path.join(runtime, 'managed-web.lock'),
  };
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireManagedServiceLock(home) {
  const { lock } = servicePaths(home);
  await mkdir(path.dirname(lock), { recursive: true });
  const tryOpen = async () => {
    const handle = await open(lock, 'wx', 0o600);
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
  };
  try {
    await tryOpen();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingPid = Number((await readFile(lock, 'utf8').catch(() => '')).trim());
    if (processAlive(existingPid)) {
      const conflict = new Error(`Frakio Work managed service is already running (pid ${existingPid}).`);
      conflict.code = 'FRAKIO_SERVICE_ALREADY_RUNNING';
      throw conflict;
    }
    await unlink(lock).catch(() => {});
    await tryOpen();
  }
  return async () => {
    const owner = Number((await readFile(lock, 'utf8').catch(() => '')).trim());
    if (owner === process.pid) await unlink(lock).catch(() => {});
  };
}

export async function writeServiceDescriptor(home, descriptor) {
  const { descriptor: destination } = servicePaths(home);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schema: 1,
    serviceProtocol: FRAKIO_SERVICE_PROTOCOL,
    ...descriptor,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, destination);
}

export async function removeServiceDescriptor(home) {
  const { descriptor } = servicePaths(home);
  const current = JSON.parse(await readFile(descriptor, 'utf8').catch(() => '{}'));
  if (current.pid === process.pid) await unlink(descriptor).catch(() => {});
}
