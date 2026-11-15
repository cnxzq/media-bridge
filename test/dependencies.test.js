import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDependencies, installPlan, main } from '../scripts/dependencies.js';

function fakeRun({ media = 'v1.21.3', ffmpeg = true, encoders = ['libx264', 'libopus', 'aac'], manager = true } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'ffmpeg') {
      if (!ffmpeg) return { error: new Error('ENOENT'), status: null };
      return { status: 0, stdout: args[0] === '-version' ? 'ffmpeg version test' : encoders.map((v, i) => `${i ? ' A.....' : ' V....D'} ${v} description`).join('\n') };
    }
    if (command === 'mediamtx') return media === null ? { error: new Error('ENOENT'), status: null } : { status: 0, stdout: media };
    if (['brew', 'winget'].includes(command)) return manager ? { status: 0, stdout: '' } : { error: new Error('ENOENT'), status: null };
    return { error: new Error('unexpected command'), status: null };
  };
  return { run, calls };
}

test('检测 MediaMTX 版本及 FFmpeg 所需编码器', () => {
  const valid = fakeRun();
  const s = inspectDependencies({ run: valid.run, env: {} });
  assert.equal(s.mediamtx.supported, true);
  assert.deepEqual(s.ffmpeg.missingEncoders, []);
  const invalid = fakeRun({ media: 'v1.21.0', encoders: ['libx264'] });
  const bad = inspectDependencies({ run: invalid.run, env: {} });
  assert.equal(bad.mediamtx.supported, false);
  assert.deepEqual(bad.ffmpeg.missingEncoders, ['libopus', 'aac']);
});

test('按平台仅安装缺失依赖，不覆盖现有安装', () => {
  const s = inspectDependencies({ run: fakeRun({ media: null }).run, env: {} });
  assert.deepEqual(installPlan('darwin', s), [{ command: 'brew', args: ['install', 'mediamtx'] }]);
  assert.deepEqual(installPlan('linux', s), [{ command: 'brew', args: ['install', 'mediamtx'] }]);
  assert.deepEqual(installPlan('win32', s), [{ command: 'winget', args: ['install', '--id', 'bluenviron.mediamtx', '--exact', '--source', 'winget'] }]);
  const old = inspectDependencies({ run: fakeRun({ media: 'v1.20.0' }).run, env: {} });
  assert.deepEqual(installPlan('darwin', old), []);
});

test('doctor 只检查，缺少包管理器时不调用安装', () => {
  const runner = fakeRun({ media: null, manager: false });
  assert.equal(main({ args: ['--check'], platform: 'darwin', run: runner.run, env: {} }), 1);
  assert.equal(runner.calls.some(call => call[0] === 'brew'), false);
  assert.equal(main({ args: [], platform: 'darwin', run: runner.run, env: {} }), 1);
  assert.equal(runner.calls.some(call => call[0] === 'brew' && call[1] === 'install'), false);
});

test('安装流程只调用缺失依赖并复检', () => {
  let installed = false;
  const calls = [];
  const base = fakeRun();
  const run = (command, args, options) => {
    calls.push([command, ...args]);
    if (command === 'mediamtx' && !installed) return { error: new Error('ENOENT'), status: null };
    if (command === 'brew' && args[0] === 'install') { installed = true; return { status: 0 }; }
    return base.run(command, args, options);
  };
  assert.equal(main({ args: [], platform: 'darwin', run, env: {} }), 0);
  assert.deepEqual(calls.filter(call => call[0] === 'brew' && call[1] === 'install'), [['brew', 'install', 'mediamtx']]);
});
