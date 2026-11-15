// 将协议细节封装在组件内；MediaMTX 的内置播放器负责实际解码和连接。
export class StreamPlayer {
  constructor(container) { this.container = container; }
  play(outputs, protocol) {
    this.destroy();
    const iframe = document.createElement('iframe');
    iframe.title = '视频播放器';
    iframe.allow = 'autoplay; fullscreen; picture-in-picture';
    const url = new URL(protocol === 'hls' ? outputs.hlsPlayer : outputs.webrtc);
    url.searchParams.set('controls', 'true');
    url.searchParams.set('muted', 'true');
    iframe.src = url.toString();
    this.container.append(iframe);
  }
  destroy() { this.container.replaceChildren(); }
}
