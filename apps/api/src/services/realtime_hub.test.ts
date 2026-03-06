import { assertEquals } from '@std/assert';
import { RealtimeHub } from '@api/src/services/realtime_hub.ts';

type MockSocket = {
  readyState: number;
  sent: string[];
  send: (data: string) => void;
};

function createMockSocket(readyState: number): MockSocket {
  return {
    readyState,
    sent: [],
    send(data: string) {
      this.sent.push(data);
    },
  };
}

Deno.test('RealtimeHub broadcasts only to open sockets', () => {
  const hub = new RealtimeHub();
  const openSocket = createMockSocket(WebSocket.OPEN);
  const closedSocket = createMockSocket(WebSocket.CLOSED);

  hub.add(openSocket as unknown as WebSocket);
  hub.add(closedSocket as unknown as WebSocket);

  hub.broadcast({
    type: 'inventory.changed',
    eventId: 'evt-1',
    ts: new Date().toISOString(),
    version: 2,
    payload: {
      productId: 'p-1',
      sku: 'SKU-1',
      availableQty: 9,
      safetyStock: 5,
      delta: -1,
      reason: 'order o-1',
    },
  });

  assertEquals(openSocket.sent.length, 1);
  assertEquals(closedSocket.sent.length, 0);
});

Deno.test('RealtimeHub remove should stop future broadcasts', () => {
  const hub = new RealtimeHub();
  const socket = createMockSocket(WebSocket.OPEN);

  hub.add(socket as unknown as WebSocket);
  hub.remove(socket as unknown as WebSocket);

  hub.broadcast({
    type: 'inventory.changed',
    eventId: 'evt-2',
    ts: new Date().toISOString(),
    version: 3,
    payload: {
      productId: 'p-1',
      sku: 'SKU-1',
      availableQty: 8,
      safetyStock: 5,
      delta: -1,
      reason: 'order o-2',
    },
  });

  assertEquals(socket.sent.length, 0);
});
