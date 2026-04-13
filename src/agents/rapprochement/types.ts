import { Facture, MouvementBancaire } from '../../types';

export interface DuplicateDetectionResult {
  isDuplicateMouvement: boolean;
  duplicateFactureIds: string[];
  explanation: string;
}

export interface SAMatchResult {
  matched: boolean;
  matchedFactureIds: string[];
  montantFactures: number;
  ecart: number;
  explanation: string;
}

export interface DiscrepancyMatchResult extends SAMatchResult {
  discrepancyReason: 'bank_fees' | 'commercial_discount' | 'grouped_payment' | 'exchange_rate' | 'none';
}

export type { Facture, MouvementBancaire };
