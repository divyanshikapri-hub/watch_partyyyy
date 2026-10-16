import { Socket } from 'socket.io-client';

export class SyncManager {
  private socket: Socket;
  private serverOffset: number = 0; // ms
  private rtt: number = 0; // ms
  private isAdjustingRate: boolean = false;

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

  /**
   * Evaluates drift against authoritative server time.
   * - Does NOT hard-seek unless drift exceeds 500ms.
   * - For drift between 150ms and 500ms, gently adjusts playbackRate (1.05 or 0.95)
   *   until drift falls below 100ms, preventing buffering stutter.
   */
  public evaluateDrift(
    currentVideoTime: number,
    expectedServerTime: number,
    videoElement: HTMLVideoElement
  ): number {
    const drift = currentVideoTime - expectedServerTime;
    const driftMs = Math.round(drift * 1000);
    const absDriftMs = Math.abs(driftMs);

    // 1. Hard seek only for severe drift (> 500ms)
    if (absDriftMs > 500) {
      this.isAdjustingRate = false;
      videoElement.playbackRate = 1.0;
      videoElement.currentTime = Math.max(0, expectedServerTime);
      return driftMs;
    }

    // 2. Minor drift adjustment between 150ms and 500ms
    if (absDriftMs >= 150) {
      this.isAdjustingRate = true;
      if (driftMs > 0) {
        // Video is ahead of server -> gently slow down
        videoElement.playbackRate = 0.95;
      } else {
        // Video is behind server -> gently speed up
        videoElement.playbackRate = 1.05;
      }
    } else if (this.isAdjustingRate) {
      // Continue adjusting until drift settles below 100ms
      if (absDriftMs < 100) {
        this.isAdjustingRate = false;
        videoElement.playbackRate = 1.0;
      }
    } else {
      // Within tolerance (< 150ms)
      videoElement.playbackRate = 1.0;
    }

    return driftMs;
  }
}