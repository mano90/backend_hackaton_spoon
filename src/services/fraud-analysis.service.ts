import { extractPdfMetadata } from './pdf-metadata.service';
import { getFraudConfig } from './fraud-config.service';
import { fetchUniteLegale } from './sirene.service';
import { checkViesVatValid, parseTvaIntracomposable } from './vies.service';
import { getKnownIbansForSupplier, registerIbanForSupplier, supplierKeyFromDoc } from './supplier-iban.service';
import { aggregateMaxSeverity, computeFraudSignals } from './fraud-score.service';
import { normalizeSiren } from '../utils/siren.util';
import { classifyVagueLibelleSnippet, summarizeFraudFromSignals } from '../agents/fraud.agent';
import type { FraudAnalysis, FraudSignal } from '../types';

function deterministicSummary(signals: FraudSignal[]): string {
  const relevant = signals.filter((s) => s.kind !== 'INFO');
  if (!relevant.length) return 'Aucun signal d’alerte notable.';
  return relevant
    .slice(0, 6)
    .map((s) => `${s.code}: ${s.evidence[0] || s.kind}`)
    .join(' ');
}

export async function runFraudAnalysis(
  doc: Record<string, unknown>,
  buffer: Buffer,
  opts?: { skipLlm?: boolean }
): Promise<FraudAnalysis> {
  const pdfMetadata = await extractPdfMetadata(buffer);
  const fraudConfig = await getFraudConfig();
  const supplierKey = supplierKeyFromDoc(doc);
  const previousIbans = await getKnownIbansForSupplier(supplierKey);

  const siren = normalizeSiren({
    siren: doc.siren as string | undefined,
    siret: doc.siret as string | undefined,
  });
  const sirene = siren ? await fetchUniteLegale(siren) : null;

  const tvaRaw = doc.tvaIntracom as string | undefined;
  const parsedVat = parseTvaIntracomposable(tvaRaw || null);
  const viesValid = parsedVat ? await checkViesVatValid(parsedVat.country, parsedVat.number) : null;

  const signals = computeFraudSignals({
    doc,
    pdfMetadata,
    previousIbans,
    fraudConfig,
    sirene,
    viesValid,
  });

  let vagueLibelleLlm: FraudAnalysis['vagueLibelleLlm'];
  if (!opts?.skipLlm && process.env.OPENAI_API_KEY && (doc.docType === 'facture' || doc.type === 'facture')) {
    vagueLibelleLlm = await classifyVagueLibelleSnippet(
      String(doc.rawText || ''),
      doc.libellePrestation ? String(doc.libellePrestation) : null
    );
    if (vagueLibelleLlm?.suspicious) {
      signals.push({
        kind: 'PHISHING',
        severity: 'medium',
        code: 'LIBELLE_VAGUE_IA',
        evidence: [vagueLibelleLlm.reason || 'Libellé jugé générique ou suspect par le modèle.'],
      });
    }
  }

  const maxSeverity = aggregateMaxSeverity(signals);

  let summary: string | undefined;
  let llmNote: string | undefined;
  if (!opts?.skipLlm && process.env.OPENAI_API_KEY && signals.length) {
    const payload = JSON.stringify(
      signals.map((s) => ({ kind: s.kind, severity: s.severity, code: s.code, evidence: s.evidence }))
    );
    const sum = await summarizeFraudFromSignals(payload);
    summary = sum.summary;
    llmNote = sum.note;
  }
  if (!summary) summary = deterministicSummary(signals);

  await registerIbanForSupplier(supplierKey, doc.iban as string | undefined);

  return {
    scannedAt: new Date().toISOString(),
    signals,
    maxSeverity,
    summary,
    llmNote,
    pdfMetadata,
    vagueLibelleLlm,
  };
}
