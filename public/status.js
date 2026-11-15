const $ = selector => document.querySelector(selector);
const stateLabels = { ready: '就绪', idle: '等待数据', unknown: '未知' };
const configLabels = { starting: '配置中', configured: '已配置', stopping: '移除中' };
const jobLabels = { starting: '启动中', running: '进程运行中', retrying: '重试中', error: '启动失败', stopped: '已停止' };
const node = (tag, text, className) => { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; };
function duration(seconds) { const h = Math.floor(seconds / 3600); const m = Math.floor(seconds % 3600 / 60); return `${h} 小时 ${m} 分钟 ${seconds % 60} 秒`; }
function renderStream(stream) {
  const card = node('section', '', 'stream');
  const title = node('div', '', 'row');
  title.append(node('h3', stream.id), node('span', stream.mode === 'copy' ? '源编码直通' : '兼容性转码', 'badge'), node('span', `配置：${configLabels[stream.state] || stream.state}`, 'muted'));
  card.append(title);
  const source = stream.source;
  card.append(node('p', `源流：${stateLabels[source.state]}${source.tracks.length ? ` · ${source.tracks.join(' / ')}` : ''} · 读取连接：${source.readers ?? '未知'}`));
  const table = document.createElement('table');
  const head = document.createElement('thead'); const headRow = document.createElement('tr');
  for (const text of ['输出', '媒体状态', '编码轨道', '读取连接', '转码进程']) headRow.append(node('th', text));
  head.append(headRow); table.append(head);
  const body = document.createElement('tbody');
  for (const [key, label, job] of [['webrtc', 'WebRTC', 'rtc'], ['hls', 'HLS', 'hls']]) {
    const output = stream.outputsStatus[key]; const tr = document.createElement('tr');
    const values = [label, stateLabels[output.state], output.tracks.join(' / ') || '—', String(output.readers ?? '未知'), stream.processes ? (jobLabels[stream.processes[job]] || stream.processes[job]) : '直通'];
    ['输出', '媒体状态', '编码轨道', '读取连接', '转码进程'].forEach((label, index) => { const td = node('td', values[index], index === 1 && output.state === 'ready' ? 'ready' : ''); td.dataset.label = label; tr.append(td); });
    body.append(tr);
  }
  table.append(body); card.append(table); return card;
}
let inFlight = false;
async function refresh() {
  if (inFlight) return;
  inFlight = true;
  try {
    const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('状态请求失败');
    const data = await response.json();
    $('#gateway').textContent = '运行中'; $('#gateway').className = 'metric ready';
    $('#media').textContent = data.media.connected ? '已连接' : '未连接'; $('#media').className = `metric ${data.media.connected ? 'ready' : 'bad'}`;
    $('#count').textContent = String(data.streams.length);
    $('#memory').textContent = `${(data.gateway.memoryBytes / 1048576).toFixed(1)} MiB`;
    $('#uptime').textContent = `网关运行时间：${duration(data.gateway.uptimeSeconds)}`;
    $('#message').textContent = `更新于 ${new Date().toLocaleTimeString()}${data.media.connected ? '' : '；媒体服务未连接，流状态未知。'}`;
    const container = $('#streams'); container.replaceChildren();
    if (!data.streams.length) container.append(node('p', '暂无注册流。前往播放器创建流后即可在此查看。', 'empty'));
    else for (const stream of data.streams) container.append(renderStream(stream));
  } catch {
    $('#gateway').textContent = '无法连接'; $('#gateway').className = 'metric bad';
    $('#media').textContent = '未知'; $('#media').className = 'metric'; $('#count').textContent = '—'; $('#memory').textContent = '—'; $('#uptime').textContent = '';
    $('#streams').replaceChildren(); $('#message').textContent = '无法获取网关状态，请检查网关是否运行。';
  } finally { inFlight = false; }
}
$('#refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 5000);
