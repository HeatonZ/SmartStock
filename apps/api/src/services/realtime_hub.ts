import type { InventoryChangedEvent } from '@shared/mod.ts';

export class RealtimeHub {
  private sockets = new Set<WebSocket>();
  private socketAdminMap = new Map<WebSocket, string>();
  private onlineCounter = new Map<string, number>();

  add(socket: WebSocket, adminId?: string) {
    this.sockets.add(socket);
    if (adminId) {
      this.socketAdminMap.set(socket, adminId);
      this.onlineCounter.set(adminId, (this.onlineCounter.get(adminId) ?? 0) + 1);
    }
  }

  remove(socket: WebSocket) {
    this.sockets.delete(socket);
    const adminId = this.socketAdminMap.get(socket);
    if (adminId) {
      const count = (this.onlineCounter.get(adminId) ?? 0) - 1;
      if (count <= 0) {
        this.onlineCounter.delete(adminId);
      } else {
        this.onlineCounter.set(adminId, count);
      }
      this.socketAdminMap.delete(socket);
    }
  }

  getOnlineAdminIds(): Set<string> {
    return new Set(this.onlineCounter.keys());
  }

  broadcast(event: InventoryChangedEvent) {
    const data = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    }
  }
}

export const realtimeHub = new RealtimeHub();
