import type { FraudSignal, PdfMetadataFields } from '../types';
import type { FraudConfig } from './fraud-config.service';
import { ibanCountryCode } from '../utils/iban.util';
import { normalizeSiren } from '../utils/siren.util';
import { daysSinceCompanyCreation, type SireneUniteLegaleInfo } from './sirene.service';
import { isRibChangeVersusHistory } from './supplier-iban.service';

function push(signals: FraudSignal[], s: FraudSignal) {
  signals.push(s);
}

function maxSev(a: FraudSignal['severity'], b: FraudSignal['severity']): FraudSignal['severity'] {
  const o = { low: 0, medium: 1, high: 2 };
  return o[a] >= o[b] ? a : b;
}

export function looksLikeFirstInvoiceReference(reference: string | null | undefined): boolean {
  if (!reference || typeof reference !== 'string') return false;
  const r = reference.trim();
  if (/^0*1$/i.test(r)) return true;
  if (/(?:^|\s)(?:n°|n[o°]|#)?\s*0*1(?:\s|$|[\/\-])/i.test(r)) return true;
  return false;
}

function hasMassAddress(addr: string | null | undefined, substrings: string[]): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase();
  return substrings.some((s) => a.includes(s.toLowerCase()));
}

function producerLooksEdited(producer: string | undefined, creator: string | undefined, patterns: string[]): boolean {
  const blob = `${producer || ''} ${creator || ''}`.toLowerCase();
  return patterns.some((p) => blob.includes(p.toLowerCase()));
}

function parseIso(d?: string): Date | null {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

export interface FraudScoreContext {
  doc: Record<string, unknown>;
  pdfMetadata: PdfMetadataFields;
  previousIbans: string[];
  fraudConfig: FraudConfig;
  sirene: SireneUniteLegaleInfo | null;
  viesValid: boolean | null;
}

export function computeFraudSignals(ctx: FraudScoreContext): FraudSignal[] {
  const signals: FraudSignal[] = [];
  const doc = ctx.doc;
  const cfg = ctx.fraudConfig;

  const montant = Number(doc.montant ?? doc.montantTTC ?? 0);
  const montantHT = doc.montantHT != null ? Number(doc.montantHT) : null;
  const montantTVA = doc.montantTVA != null ? Number(doc.montantTVA) : null;
  const reference = String(doc.reference || '');
  const rawText = String(doc.rawText || '');
  const libelle = String(doc.libellePrestation || '');
  const iban = doc.iban as string | null | undefined;
  const tvaIntra = doc.tvaIntracom as string | null | undefined;
  const adresse = doc.adresseFournisseur as string | null | undefined;

  if (montantHT != null && montantTVA != null && Number.isFinite(montant)) {
    const sum = montantHT + montantTVA;
    if (Math.abs(sum - montant) > cfg.arithToleranceEuro) {
      push(signals, {
        kind: 'AMOUNT_TAMPER',
        severity: 'high',
        code: 'HT_TVA_TTC_INCOHERENT',
        evidence: [
          `HT (${montantHT}) + TVA (${montantTVA}) = ${sum.toFixed(2)} €, TTC déclaré ${montant.toFixed(2)} € (tolérance ${cfg.arithToleranceEuro} €).`,
        ],
      });
    }
  }

  const meta = ctx.pdfMetadata;
  if (producerLooksEdited(meta.producer, meta.creator, cfg.pdfEditorProducerPatterns)) {
    push(signals, {
      kind: 'AMOUNT_TAMPER',
      severity: 'medium',
      code: 'PDF_METADATA_EDITEUR',
      evidence: [
        `Métadonnées PDF : Producer="${meta.producer || '—'}", Creator="${meta.creator || '—'}" (outil d’édition PDF détecté).`,
      ],
    });
  }

  const mod = parseIso(meta.modificationDate);
  const inv = parseIso(String(doc.date || '').slice(0, 10));
  if (mod && inv) {
    const diffDays = Math.abs((mod.getTime() - inv.getTime()) / (24 * 3600 * 1000));
    if (diffDays > 60 && mod.getTime() > inv.getTime()) {
      push(signals, {
        kind: 'AMOUNT_TAMPER',
        severity: 'low',
        code: 'PDF_MODDATE_RECENTE_VS_FACTURE',
        evidence: [
          `Date modification PDF (${meta.modificationDate}) nettement postérieure à la date de facture (${doc.date}).`,
        ],
      });
    }
  }

  if (isRibChangeVersusHistory(iban, ctx.previousIbans)) {
    push(signals, {
      kind: 'RIB_CHANGE',
      severity: 'high',
      code: 'IBAN_DIFFERENT_HISTORIQUE',
      evidence: [
        `IBAN différent des IBAN déjà observés pour ce fournisseur (${ctx.previousIbans.length} connu(s)).`,
      ],
    });
  }

  const ibC = ibanCountryCode(iban);
  const paysSiege = ctx.sirene?.paysSiege;
  if (ibC && paysSiege && ibC !== paysSiege) {
    push(signals, {
      kind: 'RIB_CHANGE',
      severity: 'medium',
      code: 'IBAN_PAYS_DIFFERENT_SIEGE',
      evidence: [`Pays IBAN ${ibC} vs pays siège attendu ${paysSiege} (SIRENE).`],
    });
  }

  const siren = normalizeSiren({
    siren: doc.siren as string | undefined,
    siret: doc.siret as string | undefined,
  });
  if (siren && ctx.sirene?.dateCreationUniteLegale) {
    const days = daysSinceCompanyCreation(ctx.sirene.dateCreationUniteLegale);
    if (days != null && days < cfg.newCompanyMaxAgeDays) {
      push(signals, {
        kind: 'FICTIVE',
        severity: 'medium',
        code: 'SOCIETE_RECENTE',
        evidence: [
          `Unité légale créée le ${ctx.sirene.dateCreationUniteLegale} (${days} jours, seuil ${cfg.newCompanyMaxAgeDays} jours).`,
        ],
      });
    }
  }

  if (looksLikeFirstInvoiceReference(reference)) {
    push(signals, {
      kind: 'FICTIVE',
      severity: 'low',
      code: 'NUMERO_FACTURE_001',
      evidence: [`Référence de facture évoquant une première facture : « ${reference} ».`],
    });
  }

  const montantNum = Number(montant);
  if (montantNum > 0 && montantNum < cfg.autoApprovalMaxAmount) {
    push(signals, {
      kind: 'PHISHING',
      severity: 'low',
      code: 'MONTANT_SOUS_SEUIL_AUTO',
      evidence: [
        `Montant TTC ${montantNum} € inférieur au seuil d’approbation automatique configuré (${cfg.autoApprovalMaxAmount} €).`,
      ],
    });
  }

  for (const kw of cfg.motsClefsPhishing) {
    const blob = `${rawText} ${libelle}`.toLowerCase();
    if (kw && blob.includes(kw.toLowerCase())) {
      push(signals, {
        kind: 'PHISHING',
        severity: 'medium',
        code: 'MOT_CLEF_PHISHING',
        evidence: [`Mot-clé ou contexte « ${kw} » détecté dans le texte ou le libellé.`],
      });
      break;
    }
  }

  if (hasMassAddress(adresse, cfg.massAddressSubstrings)) {
    push(signals, {
      kind: 'FICTIVE',
      severity: 'low',
      code: 'ADRESSE_DOMICILIATION',
      evidence: [`Adresse fournisseur évoquant une domiciliation : ${adresse?.slice(0, 120)}…`],
    });
  }

  if (tvaIntra && tvaIntra.replace(/\s/g, '').length > 4) {
    if (ctx.viesValid === false) {
      push(signals, {
        kind: 'FICTIVE',
        severity: 'high',
        code: 'TVA_INTRACOM_INVALIDE_VIES',
        evidence: [`Numéro de TVA intracommunautaire non valide selon VIES : ${tvaIntra}.`],
      });
    }
  } else if (montantNum > 50 && !tvaIntra && (doc.docType === 'facture' || doc.type === 'facture')) {
    push(signals, {
      kind: 'FICTIVE',
      severity: 'low',
      code: 'TVA_ABSENTE',
      evidence: ['Aucun numéro de TVA intracommunautaire extrait pour un montant significatif.'],
    });
  }

  return signals;
}

export function aggregateMaxSeverity(signals: FraudSignal[]): 'none' | 'low' | 'medium' | 'high' {
  if (!signals.length) return 'none';
  let m: FraudSignal['severity'] = 'low';
  let found = false;
  for (const s of signals) {
    if (s.kind === 'INFO') continue;
    found = true;
    m = maxSev(m, s.severity);
  }
  return found ? m : 'none';
}
