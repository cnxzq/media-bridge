import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const contentTypes = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/player.js', ['player.js', 'text/javascript; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/status', ['status.html', 'text/html; charset=utf-8']], ['/status.js', ['status.js', 'text/javascript; charset=utf-8']]]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createGateway({ api = 'http://127.0.0.1:9997', rtspPort = 8554, hls = 'http://127.0.0.1:8888', webrtc = 'http://127.0.0.1:8889', ffmpeg = 'ffmpeg' } = {}) {
  const streams = new Map();
  const pending = new Map();
  let closing = false;
  const startedAt = Date.now();
  async function control(path, method = 'GET', body) {
    const response = await fetch(`${api}/v3/${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`媒体服务请求失败 (${response.status})`);
    return response;
  }
  function view(stream) {
    const root = stream.mode === 'compatible' ? stream.id : `${stream.id}-source`;
    return { id: stream.id, mode: stream.mode, state: stream.state, processes: stream.mode === 'compatible' ? Object.fromEntries([...stream.processes].map(([k, v]) => [k, v.state])) : undefined,
      outputs: { webrtc: `${webrtc}/${root}${stream.mode === 'compatible' ? '-rtc' : ''}`, hls: `${hls}/${root}${stream.mode === 'compatible' ? '-hls' : ''}/index.m3u8`, hlsPlayer: `${hls}/${root}${stream.mode === 'compatible' ? '-hls' : ''}`, rtsp: `rtsp://127.0.0.1:${rtspPort}/${root}${stream.mode === 'compatible' ? '-hls' : ''}` } };
  }
  async function status() {
    let media = { connected: false };
    const paths = new Map();
    try {
      let page = 0, pageCount = 1;
      while (page < pageCount) {
        const response = await control(`paths/list?itemsPerPage=100&page=${page}`);
        const data = await response.json();
        if (!Array.isArray(data.items) || !Number.isInteger(data.pageCount) || data.pageCount < 0) throw new Error('无效状态数据');
        for (const path of data.items) paths.set(path.name, path);
        pageCount = data.pageCount;
        page++;
      }
      media = { connected: true };
    } catch { paths.clear(); }
    const pathStatus = name => {
      if (!media.connected) return { state: 'unknown', tracks: [], readers: null };
      const path = paths.get(name);
      if (!path) return { state: 'idle', tracks: [], readers: 0 };
      return { state: path.ready ? 'ready' : 'idle', tracks: Array.isArray(path.tracks) ? path.tracks.filter(track => typeof track === 'string') : [], readers: Array.isArray(path.readers) ? path.readers.length : 0 };
    };
    return {
      gateway: { startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), memoryBytes: process.memoryUsage().rss },
      media,
      streams: [...streams.values()].map(stream => ({ ...view(stream),
        source: pathStatus(`${stream.id}-source`),
        outputsStatus: stream.mode === 'copy'
          ? { webrtc: pathStatus(`${stream.id}-source`), hls: pathStatus(`${stream.id}-source`) }
          : { webrtc: pathStatus(`${stream.id}-rtc`), hls: pathStatus(`${stream.id}-hls`) },
      })),
    };
  }
  function runTranscoder(stream, kind) {
    if (stream.stopped || closing) return;
    const destination = `rtsp://127.0.0.1:${rtspPort}/${stream.id}-${kind}`;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-rtsp_transport', 'tcp', '-i', `rtsp://127.0.0.1:${rtspPort}/${stream.id}-source`, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-bf', '0', '-g', '30', '-c:a', kind === 'rtc' ? 'libopus' : 'aac', '-ar', '48000', '-f', 'rtsp', '-rtsp_transport', 'tcp', destination];
    const job = stream.processes.get(kind);
    job.state = 'starting';
    const child = spawn(ffmpeg, args, { stdio: 'ignore', windowsHide: true });
    job.child = child;
    child.once('spawn', () => { job.state = 'running'; });
    child.once('error', () => { job.state = 'error'; });
    child.once('close', () => {
      job.child = null;
      if (!stream.stopped && !closing) {
        job.state = 'retrying';
        job.timer = setTimeout(() => runTranscoder(stream, kind), 3000);
        job.timer.unref();
      } else job.state = 'stopped';
    });
  }
  async function create(address, mode) {
    if (closing) throw new Error('服务正在关闭');
    if (typeof address !== 'string' || address.length > 4096 || /[\r\n\0]/.test(address)) throw new Error('请输入有效的 RTSP 地址');
    let url;
    try { url = new URL(address); } catch { throw new Error('请输入有效的 RTSP 地址'); }
    if (!['rtsp:', 'rtsps:'].includes(url.protocol) || !url.hostname) throw new Error('请输入有效的 RTSP 地址');
    if (!['copy', 'compatible'].includes(mode)) throw new Error('无效的转换策略');
    const key = JSON.stringify([address, mode]);
    if (pending.has(key)) return pending.get(key);
    const existing = [...streams.values()].find(item => item.address === address && item.mode === mode && !item.stopped);
    if (existing) return view(existing);
    const task = createNew(address, mode);
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  async function createNew(address, mode) {
    const stream = { id: `s${randomUUID().replaceAll('-', '')}`, address, mode, state: 'starting', processes: new Map(), stopped: false };
    streams.set(stream.id, stream);
    try {
      await control(`config/paths/add/${stream.id}-source`, 'POST', { source: address, sourceOnDemand: true, rtspTransport: 'tcp' });
      if (stream.stopped || closing) { await control(`config/paths/delete/${stream.id}-source`, 'DELETE'); throw new Error('服务正在关闭'); }
      if (mode === 'compatible') for (const kind of ['rtc', 'hls']) { stream.processes.set(kind, { state: 'starting', child: null, timer: null }); runTranscoder(stream, kind); }
      stream.state = 'configured';
      return view(stream);
    } catch (error) { streams.delete(stream.id); throw error; }
  }
  async function remove(id) {
    const stream = streams.get(id);
    if (!stream) return false;
    stream.stopped = true;
    stream.state = 'stopping';
    const exits = [];
    for (const job of stream.processes.values()) {
      clearTimeout(job.timer);
      const child = job.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        exits.push(new Promise(resolve => {
          const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
          child.once('close', () => { clearTimeout(timer); resolve(); });
          child.kill();
        }));
      }
    }
    await Promise.all(exits);
    await control(`config/paths/delete/${stream.id}-source`, 'DELETE');
    streams.delete(id);
    return true;
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reply(403, { error: '来源不允许' });
      try {
        if (url.pathname === '/api/status' && req.method === 'GET') return reply(200, await status());
        if (url.pathname === '/api/streams' && req.method === 'GET') return reply(200, { streams: [...streams.values()].map(view) });
        if (url.pathname === '/api/streams' && req.method === 'POST') {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: '需要 JSON' });
          let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) return reply(413, { error: '请求过大' }); }
          const data = JSON.parse(body); return reply(201, await create(data.url, data.mode || 'copy'));
        }
        const match = /^\/api\/streams\/(s[a-f0-9]{32})$/.exec(url.pathname);
        if (match && req.method === 'DELETE') return reply(await remove(match[1]) ? 200 : 404, { ok: true });
        return reply(404, { error: '未找到' });
      } catch (error) { return reply(400, { error: error.message }); }
    }
    const file = contentTypes.get(url.pathname);
    if (!file || req.method !== 'GET') { res.writeHead(404).end(); return; }
    try { const data = await readFile(publicDir + file[0]); res.writeHead(200, { 'content-type': file[1], 'x-content-type-options': 'nosniff' }).end(data); }
    catch { res.writeHead(500).end(); }
  });
  return { server, create, remove, streams, async close() { closing = true; await Promise.allSettled([...pending.values()]); await Promise.allSettled([...streams.keys()].map(remove)); if (server.listening) await new Promise(resolve => server.close(resolve)); await delay(100); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3001);
  const gateway = createGateway({ ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg' });
  gateway.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  gateway.server.listen(port, '127.0.0.1', () => console.log(`播放器 http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => gateway.close().then(() => process.exit()));
}
