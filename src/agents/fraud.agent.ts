import { callAgent } from './base.agent';

const VAGUE_SYSTEM = `Tu évalues si une facture présente un libellé de prestation flou ou typique de surfacturation / arnaque (frais techniques non détaillés, maintenance vague, annuaire, hébergement générique).
Réponds UNIQUEMENT en JSON strict : {"suspicious": true ou false, "reason": "une courte phrase en français"}`;

const SUMMARY_SYSTEM = `Tu résumes des signaux d’alerte facture DÉJÀ calculés (liste JSON). Ne rajoute aucun fait absent de la liste. 2 à 4 phrases en français.
Réponds en JSON strict : {"summary": "...", "note": "optionnel"}`;

export async function classifyVagueLibelleSnippet(
  rawText: string,
  libellePrestation: string | null
): Promise<{ suspicious: boolean; reason?: string }> {
  if (!process.env.OPENAI_API_KEY) return { suspicious: false };
  const user = `Libellé prestation : ${libellePrestation || '—'}

Extrait document (tronqué) :
${rawText.slice(0, 3500)}`;
  try {
    const r = await callAgent(VAGUE_SYSTEM, user);
    const cleaned = r.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    const j = JSON.parse(cleaned) as { suspicious?: boolean; reason?: string };
    return { suspicious: Boolean(j.suspicious), reason: typeof j.reason === 'string' ? j.reason : undefined };
  } catch {
    return { suspicious: false };
  }
}

export async function summarizeFraudFromSignals(signalsPayload: string): Promise<{ summary?: string; note?: string }> {
  if (!process.env.OPENAI_API_KEY) return {};
  try {
    const r = await callAgent(SUMMARY_SYSTEM, signalsPayload);
    const cleaned = r.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    const j = JSON.parse(cleaned) as { summary?: string; note?: string };
    return {
      summary: typeof j.summary === 'string' ? j.summary : undefined,
      note: typeof j.note === 'string' ? j.note : undefined,
    };
  } catch {
    return {};
  }
}
