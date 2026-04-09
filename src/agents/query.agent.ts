import { callAgent } from './base.agent';
import redis from '../services/redis.service';

const QUERY_SYSTEM = `Tu es un assistant intelligent pour un système de gestion de factures et de rapprochement bancaire.
Tu as accès aux données de factures et de mouvements bancaires de l'utilisateur.
Réponds aux questions de l'utilisateur de manière claire et précise en français.
Quand tu cites des données, inclus les références et montants.
Si on te demande des calculs ou analyses, effectue-les.
Réponds au format JSON:
{
  "answer": "<ta réponse détaillée>",
  "sources": ["<liste des IDs de documents référencés>"]
}
Réponds UNIQUEMENT avec le JSON.`;

export async function queryData(userQuery: string): Promise<{ answer: string; sources: string[] }> {
  // Gather all data from Redis (exclude :pdf, :pending, and :ids keys)
  const factureKeys = (await redis.keys('facture:*')).filter((k: string) => !k.includes(':pdf') && !k.includes(':pending') && k !== 'facture:ids');
  const mouvementKeys = (await redis.keys('mouvement:*')).filter((k: string) => k !== 'mouvement:ids');
  const rapprochementKeys = (await redis.keys('rapprochement:*')).filter((k: string) => k !== 'rapprochement:ids');
  const documentKeys = (await redis.keys('document:*')).filter((k: string) => !k.includes(':pdf') && k !== 'document:ids');

  const factures = await Promise.all(
    factureKeys.map(async (k: string) => {
      const data = await redis.get(k);
      return data ? JSON.parse(data) : null;
    })
  );

  const mouvements = await Promise.all(
    mouvementKeys.map(async (k: string) => {
      const data = await redis.get(k);
      return data ? JSON.parse(data) : null;
    })
  );

  const rapprochements = await Promise.all(
    rapprochementKeys.map(async (k: string) => {
      const data = await redis.get(k);
      return data ? JSON.parse(data) : null;
    })
  );

  const documents = await Promise.all(
    documentKeys.map(async (k: string) => {
      const data = await redis.get(k);
      return data ? JSON.parse(data) : null;
    })
  );

  const context = `
DONNÉES DISPONIBLES:

FACTURES (${factures.filter(Boolean).length}):
${factures
  .filter(Boolean)
  .map((f: any) => `- ID: ${f.id} | Montant: ${f.montant} | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Ref: ${f.reference}`)
  .join('\n')}

MOUVEMENTS BANCAIRES (${mouvements.filter(Boolean).length}):
${mouvements
  .filter(Boolean)
  .map((m: any) => `- ID: ${m.id} | Montant: ${m.montant} | Date: ${m.date} | Libellé: ${m.libelle} | Type: ${m.type_mouvement}`)
  .join('\n')}

DOCUMENTS (${documents.filter(Boolean).length}):
${documents
  .filter(Boolean)
  .map((d: any) => `- ID: ${d.id} | Type: ${d.docType || d.type} | Date: ${d.date} | Fournisseur: ${d.fournisseur || d.from || ''} | Ref: ${d.reference || d.subject || ''} | Scenario: ${d.scenarioId || 'aucun'}`)
  .join('\n')}

RAPPROCHEMENTS (${rapprochements.filter(Boolean).length}):
${rapprochements
  .filter(Boolean)
  .map(
    (r: any) =>
      `- ID: ${r.id} | Mouvement: ${r.mouvementId} | Factures: ${r.factureIds?.join(', ')} | Écart: ${r.ecart} | Status: ${r.status}`
  )
  .join('\n')}

QUESTION DE L'UTILISATEUR:
${userQuery}`;

  const result = await callAgent(QUERY_SYSTEM, context);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}
