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
}

export interface AIQueryResponse {
  answer: string;
  sources: string[];
}

export type DocumentType = 'devis' | 'bon_commande' | 'bon_livraison' | 'bon_reception' | 'facture' | 'mouvement' | 'email';
