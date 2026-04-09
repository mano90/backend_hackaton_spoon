export interface Facture {
  id: string;
  fileName: string;
  rawText: string;
  montant: number;
  date: string;
  fournisseur: string;
  reference: string;
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
  type: 'mouvement';
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
  createdAt: string;
}

export interface AIQueryRequest {
  query: string;
}

export interface AIQueryResponse {
  answer: string;
  sources: string[];
}
