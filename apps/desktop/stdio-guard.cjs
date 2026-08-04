function isBrokenOutputPipe(error) {
  return error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED';
}

function guardOutputStream(stream, { name = 'output', log = () => {} } = {}) {
  if (!stream || typeof stream.on !== 'function') return () => {};

  const onError = (error) => {
    if (!isBrokenOutputPipe(error)) {
      log(`Desktop ${name} stream error: ${error?.message || String(error)}`);
      return;
    }
    // Finder, launchers, and test runners may close inherited stdio while the
    // Electron process is still alive. A later Node warning must not crash the
    // desktop main process merely because it can no longer be printed there.
    log(`Ignored closed desktop ${name} pipe (${error.code}).`);
  };
  stream.on('error', onError);
  return () => stream.removeListener?.('error', onError);
}

function guardProcessOutput(processObject, options = {}) {
  const stopStdout = guardOutputStream(processObject?.stdout, { ...options, name: 'stdout' });
  const stopStderr = guardOutputStream(processObject?.stderr, { ...options, name: 'stderr' });
  return () => {
    stopStdout();
    stopStderr();
  };
}

module.exports = { guardOutputStream, guardProcessOutput, isBrokenOutputPipe };
