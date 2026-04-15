/** Extrait un SIREN valide (9 chiffres) depuis siren/siret bruts. */
export function normalizeSiren(extracted: {
  siren?: string | null;
  siret?: string | null;
}): string | null {
  let d = extracted.siren?.replace(/\D/g, '') ?? '';
  if (d.length !== 9 && extracted.siret) {
    d = extracted.siret.replace(/\D/g, '').slice(0, 9);
  }
  return d.length === 9 ? d : null;
}
