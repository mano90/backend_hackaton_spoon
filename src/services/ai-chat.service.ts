import redis from './redis.service';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const LLM_KEY = (sessionId: string) => `ai:chat:${sessionId}:llm`;
const TURNS_KEY = (sessionId: string) => `ai:chat:${sessionId}:turns`;

const MAX_LLM_MESSAGES = 20;
const MAX_TURNS = 80;

export type LlmTurn = ChatCompletionMessageParam;

export async function getLlmHistory(sessionId: string): Promise<LlmTurn[]> {
  const raw = await redis.get(LLM_KEY(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LlmTurn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendLlmTurns(sessionId: string, userContent: string, assistantContent: string): Promise<void> {
  const prev = await getLlmHistory(sessionId);
  const next: LlmTurn[] = [
    ...prev,
    { role: 'user', content: userContent },
    { role: 'assistant', content: assistantContent },
  ];
  while (next.length > MAX_LLM_MESSAGES) {
    next.shift();
    next.shift();
  }
  await redis.set(LLM_KEY(sessionId), JSON.stringify(next));
}

export type StoredChatTurn = {
  question: string;
  answer: string;
  sources: unknown[];
  at: string;
  timelineEvents?: unknown[];
  timelineMeta?: { scope: 'global' | 'scenario'; scenarioId?: string; purchaseLabel?: string };
  dossierBriefs?: unknown[];
};

export async function getTurns(sessionId: string): Promise<StoredChatTurn[]> {
  const raw = await redis.get(TURNS_KEY(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredChatTurn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendTurn(sessionId: string, turn: StoredChatTurn): Promise<void> {
  const turns = await getTurns(sessionId);
  turns.push(turn);
  await redis.set(TURNS_KEY(sessionId), JSON.stringify(turns.slice(-MAX_TURNS)));
}

export async function resetChat(sessionId: string): Promise<void> {
  await redis.del(LLM_KEY(sessionId), TURNS_KEY(sessionId));
}
