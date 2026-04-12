export interface Facture {
  id: string;
  fileName: string;
  rawText: string;
  montant: number;
  date: string;
  fournisseur: string;
  reference: string;
  scenarioId?: string;
  type: 'facture';
  createdAt: string;
}

export interface MouvementBancaire {
  id: string;
  montant: number;
  date: string;
  libelle: string;
  type_mouvement: 'entree' | 'sortie';
  reference: string;
  scenarioId?: string;
  type: 'mouvement';
  createdAt: string;
}

export interface DemandeDevis {
  id: string;
  fileName: string;
  rawText: string;
  montant: number;
  date: string;
  fournisseur: string;
  reference: string;
  scenarioId?: string;
  type: 'devis';
  createdAt: string;
}

export interface BonCommande {
  id: string;
  fileName: string;
  rawText: string;
  montant: number;
  date: string;
  fournisseur: string;
  reference: string;
  devisRef?: string;
  scenarioId?: string;
  type: 'bon_commande';
  createdAt: string;
}

export interface BonLivraison {
  id: string;
  fileName: string;
  rawText: string;
  date: string;
  fournisseur: string;
  reference: string;
  commandeRef?: string;
  scenarioId?: string;
  type: 'bon_livraison';
  createdAt: string;
}

export interface BonReception {
  id: string;
  fileName: string;
  rawText: string;
  date: string;
  fournisseur: string;
  reference: string;
  commandeRef?: string;
  livraisonRef?: string;
  scenarioId?: string;
  type: 'bon_reception';
  createdAt: string;
}

export interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  hasRelation: boolean;
  relationType: string | null;
  scenarioId: string | null;
  type: 'email';
  createdAt: string;
}

export interface Rapprochement {
  id: string;
  mouvementId: string;
  factureIds: string[];
  montantMouvement: number;
  montantFactures: number;
  ecart: number;
  status: 'exact' | 'partial' | 'no_match';
  aiExplanation: string;
  confirmed: boolean;
  createdAt: string;
}

export interface AIQueryRequest {
  query: string;
  sessionId?: string;
}

export type AIQuerySourceKind =
  | 'document'
  | 'mouvement'
  | 'rapprochement'
  | 'timeline_global'
  | 'timeline_scenario'
  | 'unknown';

export interface AIQuerySourceRef {
  id: string;
  kind: AIQuerySourceKind;
  label: string;
  hasPdf?: boolean;
  scenarioId?: string;
}

export interface AIQueryTimelineMeta {
  scope: 'global' | 'scenario';
  scenarioId?: string;
  /** Libellé métier (ex. fournisseur), pas l’id technique S01 */
  purchaseLabel?: string;
}

/** Réponse structurée optionnelle quand la question porte sur un dossier / parcours d’achat. */
export interface AIQueryDossierBrief {
  scenarioId?: string | null;
  /** Fournisseur ou intitulé court */
  libelle?: string;
  /** Synthèse en 2–5 phrases */
  resume: string;
  /** Étapes ou pièces clés dans l’ordre */
  etapes?: string[];
  /** Incohérences, écarts, pièces manquantes, alertes */
  anomalies?: string[];
  /** Pistes : prochaines actions, contrôles complémentaires */
  pistes?: string[];
}

export interface AIQueryResponse {
  answer: string;
  sources: AIQuerySourceRef[];
  sessionId: string;
  timelineEvents?: Record<string, unknown>[];
  timelineMeta?: AIQueryTimelineMeta;
  dossierBriefs?: AIQueryDossierBrief[];
}

export interface AIQueryHistoryResponse {
  sessionId: string;
  turns: AIQueryHistoryTurn[];
}

export interface AIQueryHistoryTurn {
  question: string;
  answer: string;
  sources: AIQuerySourceRef[];
  at: string;
  timelineEvents?: Record<string, unknown>[];
  timelineMeta?: AIQueryTimelineMeta;
  dossierBriefs?: AIQueryDossierBrief[];
}

export type DocumentType = 'devis' | 'bon_commande' | 'bon_livraison' | 'bon_reception' | 'facture' | 'mouvement' | 'email';
