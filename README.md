# Media Bridge：音视频转换工具

Media Bridge 是 RTSP2WS 的独立后续项目，主要解决 **Web 端播放 RTSP 音视频流**的问题，让前端能够通过 WebRTC 或 HLS 接入播放。项目也计划支持 MP4 等其他音视频输入并转换为在线播放流。

目前处于本地验证阶段，已实现 RTSP 流输入；MP4 等文件输入尚未实现。MediaMTX 负责 RTSP 拉流和协议输出，Node 网关注册与删除源，FFmpeg 负责可选转码。页面通过 `StreamPlayer` 封装 MediaMTX 自带播放器，可以选择 WebRTC 或 HLS，播放后可手动取消静音。

## 环境及运行

- Node.js 24 或更新 LTS；MediaMTX **1.21.1 及以上**（控制 API 早期版本存在安全问题）。
- FFmpeg，兼容模式需要 `libx264`、`libopus` 和 AAC 编码器。
- 当前配置只监听本机，适合本机验证。

两个终端分别运行：

```sh
cd media-bridge
mediamtx mediamtx.yml
```

```sh
cd media-bridge
node server.js
```

打开 `http://127.0.0.1:3001`，可从首页进入服务器状态页（`http://127.0.0.1:3001/status`），输入 RTSP 地址，选择策略、创建流并播放。需要播放声音时，在播放器中取消静音。`FFMPEG_PATH` 可指定 FFmpeg 路径；`PORT` 可改变网关端口。

## 策略

- **源编码直通**：按需拉取源流，输出 HLS 和 WebRTC，不重新编码。是否有声音和画面由协议、浏览器和源编码共同决定，例如 AAC 无法直接作为 WebRTC 音频；H.265 或含 B 帧的 H.264 也可能不兼容。
- **兼容性转码**：对同一源分别生成 H.264 Baseline + Opus（WebRTC）以及 H.264 Baseline + AAC（HLS），保留可选音频轨。两个 FFmpeg 在流创建后持续运行，移除流时关闭；这比直通消耗更多 CPU。没有音频轨时只能播放视频。

流 ID 不包含摄像机地址；相同地址与策略在同一个网关进程中复用。当前流存在内存中，客户端关闭页面不会自动删除，须点击移除或停止网关。媒体进程启动不代表已连接到视频源或浏览器成功播放；断流后兼容模式每 3 秒重试。状态页展示网关、媒体服务、流及各输出的就绪状态、编码轨道、读取连接和转码进程，并每 5 秒刷新。`GET /api/status` 提供同样的状态数据，`GET /api/streams` 提供流信息。读取连接包括内部转码进程，网关内存不包括 MediaMTX 或 FFmpeg。`POST /api/streams` JSON 字段为 `url` 和 `mode`（`copy` 或 `compatible`），返回输出地址；`DELETE /api/streams/{id}` 删除。

## 前端接入示例

创建流后，将响应中的 `outputs` 交给播放器组件：

```html
<div id="player"></div>
<script type="module">
  import { StreamPlayer } from '/player.js';
  const response = await fetch('/api/streams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'rtsp://127.0.0.1:8554/camera', mode: 'compatible' }),
  });
  if (!response.ok) throw new Error('创建流失败');
  const stream = await response.json();
  const player = new StreamPlayer(document.querySelector('#player'));
  player.play(stream.outputs, 'webrtc'); // 或 'hls'
  // 播放结束时：player.destroy()；不再需要流时调用 DELETE /api/streams/{id}。
</script>
```

`player.destroy()` 只关闭页面中的播放器；删除流是服务端操作，会影响使用同一流 ID 的其他观看者。具体应用需要在自身服务端进行授权和流生命周期管理。

## 已知边界

这是本地首版，不提供账户、持久化、网络公开部署、播放器自动回退、硬件转码、自动编码探测、录像或无人观看时停止转码。WebRTC/HLS 不保证任意来源或浏览器都能直接播放；HLS 延迟和 iOS 分片兼容性必须实测。`/api/streams` 输出不含源地址，但源地址会由网关与 MediaMTX 在内存中使用。控制 API 和本服务不能暴露到不可信网络；实际网络部署需要设计认证、TLS、目标地址限制及 WebRTC 网络穿透。

网关和 MediaMTX 是独立进程；网关被强制结束时无法执行清理，动态源配置可能留在 MediaMTX 进程内。正常退出优先使用 Ctrl+C；若发生异常退出，重启 MediaMTX 可清除本地验证版的动态配置。
