import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGateway } from '../server.js';
async function fixture() {
  const paths = new Map();
  let available = true;
  const media = http.createServer(async (req, res) => {
    if (!available) { res.writeHead(503).end(); return; }
    const name = req.url.split('/').at(-1);
    if (req.method === 'GET' && req.url.startsWith('/v3/paths/list')) {
      const items = [...paths.keys()].map(name => ({ name, ready: true, tracks: ['H264', 'Opus'], readers: [{ id: 'test' }] }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pageCount: 1, items }));
    } else if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; paths.set(name, JSON.parse(body)); res.writeHead(200).end(); }
    else if (req.method === 'DELETE') { paths.delete(name); res.writeHead(200).end(); }
    else res.writeHead(404).end();
  });
  await new Promise(resolve => media.listen(0, '127.0.0.1', resolve));
  const gateway = createGateway({ api: `http://127.0.0.1:${media.address().port}` });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  return { gateway, paths, setAvailable(value) { available = value; }, url: `http://127.0.0.1:${gateway.server.address().port}`, async close() { await gateway.close(); await new Promise(resolve => media.close(resolve)); } };
}
test('同一来源并发注册时只创建一条源流，状态不泄露地址', async t => {
  const f = await fixture(); t.after(() => f.close());
  const source = 'rtsp://user:secret@127.0.0.1/camera';
  const [a, b] = await Promise.all([f.gateway.create(source, 'copy'), f.gateway.create(source, 'copy')]);
  assert.equal(a.id, b.id); assert.equal(f.paths.size, 1);
  assert.equal(f.paths.get(`${a.id}-source`).sourceOnDemand, true);
  const response = await (await fetch(`${f.url}/api/streams`)).text();
  assert.ok(!response.includes('secret'));
  assert.equal(await f.gateway.remove(a.id), true); assert.equal(f.paths.size, 0);
});
test('网关拒绝无效来源和跨源修改', async t => {
  const f = await fixture(); t.after(() => f.close());
  await assert.rejects(() => f.gateway.create('http://localhost', 'copy'));
  const res = await fetch(`${f.url}/api/streams`, { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'rtsp://localhost/test' }) });
  assert.equal(res.status, 403); assert.equal(f.paths.size, 0);
});
test('关闭网关清除已注册源流', async () => {
  const f = await fixture(); await f.gateway.create('rtsp://127.0.0.1/test', 'copy');
  await f.close(); assert.equal(f.paths.size, 0);
});

test('状态接口区分媒体就绪与服务断开并隐藏源地址', async t => {
  const f = await fixture(); t.after(() => f.close());
  const stream = await f.gateway.create('rtsp://user:secret@127.0.0.1/camera', 'copy');
  const response = await fetch(`${f.url}/api/status`);
  const text = await response.text();
  assert.ok(!text.includes('secret'));
  const data = JSON.parse(text);
  assert.equal(data.media.connected, true);
  assert.equal(data.streams[0].id, stream.id);
  assert.deepEqual(data.streams[0].source, { state: 'ready', tracks: ['H264', 'Opus'], readers: 1 });
  assert.deepEqual(data.streams[0].outputsStatus.hls, data.streams[0].source);
  f.setAvailable(false);
  const disconnected = await (await fetch(`${f.url}/api/status`)).json();
  assert.equal(disconnected.media.connected, false);
  assert.equal(disconnected.streams[0].source.state, 'unknown');
  assert.equal(disconnected.streams[0].outputsStatus.hls.readers, null);
  f.setAvailable(true);
});

test('媒体服务不可达时状态为未知', async () => {
  const gateway = createGateway({ api: 'http://127.0.0.1:1' });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  try {
    const data = await (await fetch(`http://127.0.0.1:${gateway.server.address().port}/api/status`)).json();
    assert.equal(data.media.connected, false);
    assert.deepEqual(data.streams, []);
  } finally { await gateway.close(); }
});
