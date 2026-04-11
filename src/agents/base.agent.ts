import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import dotenv from 'dotenv';

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function callAgent(systemPrompt: string, userMessage: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}

export async function callAgentWithHistory(
  systemPrompt: string,
  historyMessages: ChatCompletionMessageParam[],
  userMessage: string
): Promise<string> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [{ role: 'system', content: systemPrompt }, ...historyMessages, { role: 'user', content: userMessage }],
  });

  return response.choices[0]?.message?.content ?? '';
}
