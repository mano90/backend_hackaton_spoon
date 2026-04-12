import crypto from 'crypto';
import redis from './redis.service';

const PREFIX = 'dup:pdf:sha256:';

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function indexKey(hex: string): string {
  return `${PREFIX}${hex}`;
}

/** Returns another document id with the same file hash, if any (excluding optional ids). */
export async function findDuplicateDocumentIdByHash(
  hash: string,
  excludeIds?: Set<string>
): Promise<string | null> {
  const members = await redis.smembers(indexKey(hash));
  for (const id of members) {
    if (!excludeIds?.has(id)) return id;
  }
  return null;
}

export async function registerDocumentHash(hash: string, documentId: string): Promise<void> {
  await redis.sadd(indexKey(hash), documentId);
}

export async function unregisterDocumentHash(hash: string, documentId: string): Promise<void> {
  await redis.srem(indexKey(hash), documentId);
}

/** Set contentSha256 on doc and register in the duplicate index (call when persisting a PDF document). */
export async function persistDocumentHashFromBuffer(doc: Record<string, unknown>, buffer: Buffer): Promise<string> {
  const existing = doc.contentSha256;
  const hash =
    typeof existing === 'string' && /^[a-f0-9]{64}$/i.test(existing) ? existing : sha256Buffer(buffer);
  doc.contentSha256 = hash;
  await registerDocumentHash(hash, doc.id as string);
  return hash;
}

/** Ensure hash on doc from base64 PDF and register (e.g. confirm route). */
export async function persistDocumentHashFromBase64(doc: Record<string, unknown>, pdfBase64: string): Promise<string> {
  const buf = Buffer.from(pdfBase64, 'base64');
  return persistDocumentHashFromBuffer(doc, buf);
}

/** Compute and store contentSha256 + Redis index for documents that predate hashing. */
export async function backfillMissingContentSha256(): Promise<{ updated: number }> {
  const ids = await redis.smembers('document:ids');
  let updated = 0;
  for (const id of ids) {
    const data = await redis.get(`document:${id}`);
    if (!data) continue;
    const doc = JSON.parse(data) as Record<string, unknown>;
    if (typeof doc.contentSha256 === 'string' && /^[a-f0-9]{64}$/i.test(doc.contentSha256)) continue;
    const pdf = await redis.get(`document:${id}:pdf`);
    if (!pdf) continue;
    await persistDocumentHashFromBuffer(doc, Buffer.from(pdf, 'base64'));
    await redis.set(`document:${id}`, JSON.stringify(doc));
    updated++;
  }
  return { updated };
}
