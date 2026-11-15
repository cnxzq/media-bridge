import { StreamPlayer } from './player.js';
const player = new StreamPlayer(document.querySelector('#player'));
const status = document.querySelector('#status');
const play = document.querySelector('#play');
const stop = document.querySelector('#stop');
let stream;
async function request(url, options) { const res = await fetch(url, options); const data = await res.json(); if (!res.ok) throw new Error(data.error || '请求失败'); return data; }
document.querySelector('#form').addEventListener('submit', async event => {
  event.preventDefault();
  if (stream) { status.textContent = '请先移除当前流'; return; }
  try {
    status.textContent = '正在创建流…';
    stream = await request('/api/streams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: document.querySelector('#url').value.trim(), mode: document.querySelector('#mode').value }) });
    document.querySelector('#url').value = '';
    play.disabled = stop.disabled = false;
    status.textContent = '流已创建，点击播放。兼容转码需要等待片刻。';
  } catch (error) { status.textContent = error.message; }
});
play.addEventListener('click', () => { player.play(stream.outputs, document.querySelector('#protocol').value); status.textContent = '正在连接，请查看播放器状态；需要声音时在播放器中取消静音。'; });
stop.addEventListener('click', async () => {
  try { await request(`/api/streams/${stream.id}`, { method: 'DELETE' }); player.destroy(); stream = null; play.disabled = stop.disabled = true; status.textContent = '流已移除'; }
  catch (error) { status.textContent = error.message; }
});
