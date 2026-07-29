import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all Hermes Runtime construction paths pin and validate the DDGS fallback', async () => {
  const [builder, preparer, api] = await Promise.all([
    readFile(new URL('./build-hermes-runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./prepare-runtime.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/api/server.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(builder, /ddgsVersion = '9\.14\.4'/);
  assert.match(builder, /`ddgs==\$\{ddgsVersion\}`/);
  assert.match(builder, /pythonDependencies:.*ddgs: ddgsVersion/);
  assert.match(builder, /get_provider\("ddgs"\)/);
  assert.match(builder, /\['npx', '\.\.\/lib\/node_modules\/npm\/bin\/npx-cli\.js'\]/);
  assert.match(preparer, /ddgs: '9\.14\.4'/);
  assert.match(preparer, /metadata\.version\("ddgs"\)/);
  assert.match(preparer, /get_provider\("ddgs"\)/);
  assert.match(preparer, /Runtime npx validation failed/);
  assert.match(api, /requiredDdgsVersion = '9\.14\.4'/);
  assert.match(api, /`ddgs==\$\{requiredDdgsVersion\}`/);
  assert.match(api, /pythonDependencies:.*ddgs: requiredDdgsVersion/);
  assert.match(api, /get_provider\("ddgs"\)/);
  assert.match(api, /repairPortableNodeLinks\(staging\)/);
});
