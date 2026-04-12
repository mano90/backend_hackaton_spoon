import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';

let io: Server | null = null;

export type ImportProgressEvent = {
  phase: 'reading' | 'parsing' | 'saving' | 'done' | 'error';
  message: string;
  percent: number;
  current?: number;
  total?: number;
};

export function attachRealtime(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: 'http://localhost:4200', credentials: true },
  });
  io.on('connection', (socket) => {
    socket.emit('ready', { socketId: socket.id });
  });
  return io;
}

export function emitImportProgress(socketId: string | undefined, ev: ImportProgressEvent): void {
  if (!socketId || !io) return;
  try {
    io.to(socketId).emit('import:progress', ev);
  } catch (e) {
    console.warn('[realtime-import] emit failed:', e);
  }
}
