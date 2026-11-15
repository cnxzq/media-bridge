import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const minimumMediaMtx = [1, 21, 1];
const encoders = ['libx264', 'libopus', 'aac'];

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function inspectDependencies({ run = spawnSync, env = process.env } = {}) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  const mediamtx = env.MEDIAMTX_PATH || 'mediamtx';
  const ffmpegVersion = run(ffmpeg, ['-version'], { encoding: 'utf8', windowsHide: true });
  const mediaVersion = run(mediamtx, ['--version'], { encoding: 'utf8', windowsHide: true });
  const ffmpegFound = !ffmpegVersion.error && ffmpegVersion.status === 0;
  const mediaFound = !mediaVersion.error && mediaVersion.status === 0;
  const ffmpegEncoders = ffmpegFound ? run(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true }) : null;
  const output = ffmpegEncoders?.status === 0 ? ffmpegEncoders.stdout || '' : '';
  const missingEncoders = ffmpegFound ? encoders.filter(name => !new RegExp(`^\\s*[A-Z.]{6}\\s+${name}\\s`, 'm').test(output)) : [];
  const versionText = mediaFound ? `${mediaVersion.stdout || ''} ${mediaVersion.stderr || ''}` : '';
  const versionMatch = versionText.match(/\bv?(\d+)\.(\d+)\.(\d+)/);
  const version = versionMatch ? versionMatch.slice(1, 4).map(Number) : null;
  return {
    ffmpeg: { command: ffmpeg, found: ffmpegFound, missingEncoders, encoderCheckFailed: ffmpegFound && ffmpegEncoders?.status !== 0 },
    mediamtx: { command: mediamtx, found: mediaFound, version: versionMatch?.[0] || null, supported: !!version && compareVersions(version, minimumMediaMtx) >= 0 },
  };
}

export function installPlan(platform, status) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw new Error('暂不支持此操作系统，请手动安装依赖。');
  const missing = [];
  if (!status.ffmpeg.found) missing.push('ffmpeg');
  if (!status.mediamtx.found) missing.push('mediamtx');
  if (!missing.length) return [];
  if (platform === 'win32') {
    const ids = { ffmpeg: 'Gyan.FFmpeg', mediamtx: 'bluenviron.mediamtx' };
    return missing.map(name => ({ command: 'winget', args: ['install', '--id', ids[name], '--exact', '--source', 'winget'] }));
  }
  return [{ command: 'brew', args: ['install', ...missing] }];
}

function printStatus(status) {
  console.log(status.ffmpeg.found ? `FFmpeg：可运行 (${status.ffmpeg.command})` : `FFmpeg：未找到 (${status.ffmpeg.command})`);
  if (status.ffmpeg.encoderCheckFailed) console.error('FFmpeg 编码器检测失败。');
  else if (status.ffmpeg.missingEncoders.length) console.error(`FFmpeg 缺少兼容转码所需编码器：${status.ffmpeg.missingEncoders.join(', ')}`);
  else if (status.ffmpeg.found) console.log('FFmpeg：兼容转码编码器可用');
  if (!status.mediamtx.found) console.log(`MediaMTX：未找到 (${status.mediamtx.command})`);
  else if (!status.mediamtx.version) console.error('MediaMTX：无法识别版本，要求 1.21.1 或更高版本。');
  else console.log(`MediaMTX：${status.mediamtx.version}${status.mediamtx.supported ? '（满足要求）' : '（版本过旧，要求 1.21.1 或更高版本）'}`);
}
function valid(status) { return status.ffmpeg.found && !status.ffmpeg.encoderCheckFailed && !status.ffmpeg.missingEncoders.length && status.mediamtx.found && status.mediamtx.supported; }

export function main({ args = process.argv.slice(2), platform = process.platform, run = spawnSync, env = process.env } = {}) {
  if (args.some(arg => arg !== '--check')) { console.error('用法：node scripts/dependencies.js [--check]'); return 2; }
  let status = inspectDependencies({ run, env });
  printStatus(status);
  if (args.includes('--check')) return valid(status) ? 0 : 1;
  const plan = installPlan(platform, status);
  if (!plan.length) {
    if (!valid(status)) console.error('已有依赖不满足要求，请手动升级或替换；安装脚本不会覆盖已有程序。');
    else console.log('依赖已就绪，无需安装。');
    return valid(status) ? 0 : 1;
  }
  const manager = plan[0].command;
  const check = run(manager, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (check.error || check.status !== 0) { console.error(`未找到 ${manager}。请先安装并配置 ${manager}，再重新运行。`); return 1; }
  for (const step of plan) {
    console.log(`执行：${step.command} ${step.args.join(' ')}`);
    const result = run(step.command, step.args, { stdio: 'inherit', windowsHide: false });
    if (result.error || result.status !== 0) { console.error(`${step.command} 安装失败或被取消。`); return 1; }
  }
  status = inspectDependencies({ run, env });
  printStatus(status);
  if (!valid(status)) {
    console.error('安装后尚未通过检查；Windows 可能需要重新打开终端以刷新 PATH，然后运行 npm run doctor。');
    return 1;
  }
  console.log('依赖已就绪。');
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
