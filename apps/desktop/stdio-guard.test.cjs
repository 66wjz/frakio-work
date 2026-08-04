const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { guardProcessOutput } = require('./stdio-guard.cjs');

test('closed stdout and stderr pipes are consumed and recorded', () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const logs = [];
  const stop = guardProcessOutput({ stdout, stderr }, { log: (message) => logs.push(message) });

  assert.doesNotThrow(() => stdout.emit('error', Object.assign(new Error('broken'), { code: 'EPIPE' })));
  assert.doesNotThrow(() => stderr.emit('error', Object.assign(new Error('closed'), { code: 'ERR_STREAM_DESTROYED' })));
  assert.deepEqual(logs, [
    'Ignored closed desktop stdout pipe (EPIPE).',
    'Ignored closed desktop stderr pipe (ERR_STREAM_DESTROYED).',
  ]);

  stop();
  assert.equal(stdout.listenerCount('error'), 0);
  assert.equal(stderr.listenerCount('error'), 0);
});

test('other output errors remain visible in the desktop log', () => {
  const stderr = new EventEmitter();
  const logs = [];
  guardProcessOutput({ stderr }, { log: (message) => logs.push(message) });

  stderr.emit('error', Object.assign(new Error('permission denied'), { code: 'EACCES' }));
  assert.deepEqual(logs, ['Desktop stderr stream error: permission denied']);
});
