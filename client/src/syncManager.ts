import { Socket } from 'socket.io-client';

export class SyncManager {
  private socket: Socket;
  private serverOffset: number = 0; // ms
  private rtt: number = 0; // ms


  constructor(socket: Socket) {
    this.socket = socket;
    this.initSyncProtocol();
  }

  private initSyncProtocol() {
    this.socket.on('sync:pong', ({ clientSendTime, serverTime }: { clientSendTime: number; serverTime: number }) => {
      const now = performance.now();
      const measuredRtt = now - clientSendTime;
      this.rtt = measuredRtt;
      this.serverOffset = serverTime - (Date.now() - measuredRtt / 2);
    });

    setInterval(() => {
      this.pingServer();
    }, 3000);
    this.pingServer();
  }

  public pingServer() {
    this.socket.emit('sync:ping', performance.now());
  }

  public getServerNow(): number {
    return Date.now() + this.serverOffset;
  }

  public getRTT(): number {
    return Math.round(this.rtt);
  }

  public evaluateDrift(currentVideoTime: number, expectedServerTime: number, videoElement: HTMLVideoElement): number {
    const drift = currentVideoTime - expectedServerTime;
    const driftMs = Math.round(drift * 1000);

    if (Math.abs(driftMs) > 50 && Math.abs(driftMs) <= 500) {
      if (driftMs > 0) {
        videoElement.playbackRate = 0.95;
      } else {
        videoElement.playbackRate = 1.05;
      }
    } else if (Math.abs(driftMs) > 500) {
      videoElement.playbackRate = 1.0;
      videoElement.currentTime = Math.max(0, expectedServerTime);
    } else {
      videoElement.playbackRate = 1.0;
    }

    return driftMs;
  }
}