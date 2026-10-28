import { io, type Socket } from "socket.io-client";
import { API_URL } from "./config";

/** Creates (but doesn't connect) a socket. Call `socket.connect()` inside an effect. */
export function createSocket(token?: string | null): Socket {
  return io(API_URL, {
    autoConnect: false,
    transports: ["websocket"], // skip long-polling upgrade for lower latency
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4_000,
  });
}

export function emitWithAck<T = any>(socket: Socket, event: string, payload: unknown, timeoutMs = 8_000): Promise<T> {
  return socket.timeout(timeoutMs).emitWithAck(event, payload) as Promise<T>;
}
