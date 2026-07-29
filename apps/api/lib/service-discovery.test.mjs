import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireManagedServiceLock, FRAKIO_SERVICE_PROTOCOL, removeServiceDescriptor, servicePaths, writeServiceDescriptor } from './service-discovery.mjs';

test('managed service descriptor is atomic and lock prevents a second writer', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'frakio-service-'));
  const release = await acquireManagedServiceLock(home);
  await assert.rejects(() => acquireManagedServiceLock(home), /already running/);
  await writeServiceDescriptor(home, { deploymentMode: 'managed-web', pid: process.pid, port: 8787 });
  const descriptor = JSON.parse(await readFile(servicePaths(home).descriptor, 'utf8'));
  assert.equal(descriptor.serviceProtocol, FRAKIO_SERVICE_PROTOCOL);
  assert.equal(descriptor.deploymentMode, 'managed-web');
  await removeServiceDescriptor(home);
  await release();
});
