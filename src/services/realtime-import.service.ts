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

/** Progression import PDF multiple (documents/upload-batch) */
export type DocumentsBatchProgressEvent = {
  phase: 'started' | 'processing' | 'linking' | 'done' | 'error';
  message: string;
  percent: number;
  fileName?: string;
  index?: number;
  total?: number;
  outcome?: string;
  /** Étape métier courante (ex. extract_text, classify) — optionnel pour l’UI */
  stage?: string;
  /** Sous-étape i / nombre d’étapes pour ce fichier (optionnel) */
  step?: number;
  stepCount?: number;
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

/** Diffuse la progression d’import CSV à **tous** les clients Socket.io connectés. */
export function emitImportProgress(ev: ImportProgressEvent): void {
  if (!io) return;
  try {
    io.emit('import:progress', ev);
  } catch (e) {
    console.warn('[realtime-import] emit failed:', e);
  }
}

/** Diffuse la progression upload-batch PDF à **tous** les clients Socket.io connectés. */
export function emitDocumentsBatchProgress(ev: DocumentsBatchProgressEvent): void {
  if (!io) return;
  try {
    io.emit('documents-batch:progress', ev);
  } catch (e) {
    console.warn('[realtime-import] documents-batch emit failed:', e);
  }
}
