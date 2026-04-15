/**
 * Synthèse déterministe par parcours (scenarioId) pour enrichir le contexte LLM
 * (résumé machine, étapes, anomalies évidentes sans appel IA).
 */

function labelType(t: string): string {
  const m: Record<string, string> = {
    devis: 'Devis',
    bon_commande: 'Bon de commande',
    bon_livraison: 'Bon de livraison',
    bon_reception: 'Bon de réception',
    facture: 'Facture',
    email: 'Email',
  };
  return m[t] || t;
}

/**
 * Bloc texte ajouté au message utilisateur du query agent.
 */
export function buildDossierDigestBlock(
  docById: Map<string, Record<string, unknown>>,
  rappById: Map<string, Record<string, unknown>>
): string {
  const byScenario = new Map<string, Record<string, unknown>[]>();
  for (const d of docById.values()) {
    const sid = d.scenarioId;
    if (sid == null || String(sid).trim() === '') continue;
    const k = String(sid);
    if (!byScenario.has(k)) byScenario.set(k, []);
    byScenario.get(k)!.push(d);
  }

  const lines: string[] = [];
  lines.push('');
  lines.push('=== SYNTHESE_AUTOMATIQUE_PAR_PARCOURS (données calculées — toute réponse sur un « dossier » doit s’appuyer dessus ET sur les lignes DOCUMENTS ci-dessus) ===');
  if (byScenario.size === 0) {
    lines.push('Aucun document avec scenarioId (parcours) : les dossiers ne sont pas reliés ou la base est vide.');
    lines.push('================================================================');
    return lines.join('\n');
  }

  for (const [scenarioId, docs] of byScenario) {
    docs.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const types = docs.map((d) => String(d.docType || d.type || '?'));
    const fournisseur = docs.map((d) => d.fournisseur || d.from).find((f) => f && String(f).trim());
    const typesSet = new Set(types);

    const etapes = docs.map((d, i) => {
      const ty = String(d.docType || d.type || '?');
      const ref = String(d.reference || d.subject || '—');
      const dt = String(d.date || '—');
      const m = d.montant != null && d.montant !== '' ? `${d.montant}` : '—';
      return `  ${i + 1}. [${labelType(ty)}] ref ${ref} | date ${dt} | montant ${m} EUR | id ${d.id}`;
    });

    const anomalies: string[] = [];
    if (typesSet.has('bon_commande') && !typesSet.has('facture')) {
      anomalies.push('Bon de commande présent mais aucune facture dans ce parcours.');
    }
    if (typesSet.has('devis') && !typesSet.has('bon_commande') && !typesSet.has('facture')) {
      anomalies.push('Devis seul : pas de bon de commande ni facture dans le même parcours.');
    }
    const factureIds = docs
      .filter((d) => String(d.docType || d.type) === 'facture')
      .map((d) => String(d.id))
      .filter(Boolean);

    let rappForScenario = 0;
    for (const r of rappById.values()) {
      const fids = (r.factureIds as string[]) || [];
      const hit = fids.some((fid) => factureIds.includes(fid));
      if (!hit) continue;
      rappForScenario += 1;
      const ec = Number(r.ecart ?? 0);
      if (Math.abs(ec) > 0.02) {
        anomalies.push(`Rapprochement ${r.id} : écart ${r.ecart} € (attendu 0 pour match exact).`);
      }
      const st = String(r.status || '');
      if (st && st !== 'exact' && st !== 'confirmed') {
        anomalies.push(`Rapprochement ${r.id} : statut « ${st} ».`);
      }
    }
    if (factureIds.length && rappForScenario === 0) {
      anomalies.push('Facture(s) du parcours sans rapprochement bancaire lié (aucun rapprochement ne cite ces IDs facture).');
    }
    if (docs.length === 1) {
      anomalies.push('Une seule pièce dans ce parcours (chaîne incomplète ou dossier minimal).');
    }

    for (const d of docs) {
      const fa = d.fraudAnalysis as
        | { maxSeverity?: string; summary?: string; signals?: { code: string }[] }
        | undefined;
      if (fa?.signals && fa.signals.length > 0) {
        const sev = fa.maxSeverity ?? 'signal';
        const sum =
          typeof fa.summary === 'string'
            ? fa.summary.slice(0, 280)
            : fa.signals.map((s) => s.code).join(', ');
        anomalies.push(`Analyse fraude [${sev}] — document ${d.id} : ${sum}`);
      }
    }

    lines.push(`--- Parcours ${scenarioId}${fournisseur ? ` — fournisseur probable : ${fournisseur}` : ''} ---`);
    lines.push(`Nombre de pièces : ${docs.length}`);
    etapes.forEach((l) => lines.push(l));
    lines.push('Types présents : ' + [...typesSet].map(labelType).join(', '));
    if (anomalies.length) {
      lines.push('Alertes / anomalies (heuristique) :');
      anomalies.forEach((a) => lines.push('  - ' + a));
    } else {
      lines.push('Aucune alerte heuristique forte (vérifier quand même cohérence métier).');
    }
  }
  lines.push('================================================================');
  return lines.join('\n');
}
