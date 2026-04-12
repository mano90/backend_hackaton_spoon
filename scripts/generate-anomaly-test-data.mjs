/**
 * Génère des jeux de données volumineux pour tests (CSV, JSON, images).
 * Usage: node scripts/generate-anomaly-test-data.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-data', 'anomalies');
const IMG = path.join(OUT, 'images');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// --- 1x1 PNG + GIF (tests upload type fichier) ---
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const GIF_1X1 = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

/** Ligne CSV valide */
function validRow(i, dayOffset) {
  const d = new Date(2026, 0, 15 + (dayOffset % 200));
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const amt = (Math.random() > 0.5 ? -1 : 1) * (10 + Math.floor(Math.random() * 50000)) + Math.random();
  const lib = randomPick([
    'VIR FOURNISSEUR',
    'PAIEMENT CB',
    'PRELEVEMENT',
    'VIREMENT RECU',
    'LOYER',
    'FRAIS BANCAIRES',
  ]);
  return `${iso};${amt.toFixed(2).replace('.', ',')};${lib} ${i};REF-${pad(i, 5)};${amt < 0 ? 'sortie' : 'entree'}`;
}

/** Lignes volontairement invalides / ambiguës pour le parseur CSV mouvements */
function badRow(kind, lineNo) {
  switch (kind) {
    case 'no_date':
      return `;;Montant seul;-50,00;Libellé sans date;REF-X${lineNo}`;
    case 'bad_date':
      return randomPick([
        `32/13/2026;-10,00;Date impossible;BAD-D${lineNo}`,
        `2026-99-01;-10,00;Mois 99;BAD-M${lineNo}`,
        `not-a-date;-10,00;Texte en date;BAD-T${lineNo}`,
        `00/00/0000;100,00;Zéros;BAD-Z${lineNo}`,
      ]);
    case 'bad_amount':
      return randomPick([
        `2026-04-01;;Pas de montant;AMT-${lineNo}`,
        `2026-04-01;abc;Montant lettres;AMT-${lineNo}`,
        `2026-04-01;1.2.3.4;Montant invalide;AMT-${lineNo}`,
        `2026-04-01;NaN;NaN;AMT-${lineNo}`,
      ]);
    case 'empty_row':
      return ';;;;';
    case 'incomplete':
      return `2026-05-10`;
    case 'wrong_sep':
      return `2026-05-11 | -20 | pipe au lieu de sep`;
    case 'huge_amount':
      return `2026-05-12;999999999999999999999,99;Montant absurde;BIG-${lineNo}`;
    case 'negative_libelle_only':
      return `2026-05-13;-1,00;`; // ref vide
    default:
      return `2026-05-14;-1,00;OK minimal;OK-${lineNo}`;
  }
}

function buildStressCsv(rows = 600) {
  const header = 'Date;Montant;Libellé;Référence;Sens';
  const lines = [header];
  const kinds = [
    'no_date',
    'bad_date',
    'bad_amount',
    'empty_row',
    'incomplete',
    'wrong_sep',
    'huge_amount',
    'valid_mix',
  ];
  for (let i = 0; i < rows; i++) {
    const roll = Math.random();
    if (roll < 0.62) lines.push(validRow(i, i));
    else if (roll < 0.78) lines.push(badRow(randomPick(kinds.filter((k) => k !== 'valid_mix')), i));
    else lines.push(validRow(i + 999, i));
  }
  return lines.join('\n') + '\n';
}

/** Variante virgule avec montants entre guillemets (style Excel export US) */
function buildStressCommaCsv(rows = 400) {
  const header = 'Date,Montant,Libelle,Reference,Type';
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const roll = Math.random();
    if (roll < 0.15) {
      lines.push(`2026-03-01,"-1${i},50",Virgule dans montant FR,RC-${i},sortie`);
      continue;
    }
    if (roll < 0.25) {
      lines.push(`,,Incomplete row ${i},,`);
      continue;
    }
    const d = new Date(2026, 2, 1 + (i % 100));
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const amt = (Math.random() > 0.5 ? -1 : 1) * (100 + i);
    lines.push(`${iso},${amt.toFixed(2)},Label ${i},R-C-${pad(i, 4)},${amt < 0 ? 'sortie' : 'entree'}`);
  }
  return lines.join('\n') + '\n';
}

function buildParseTortureCsv() {
  const header = 'Date;Montant;Libellé;Référence';
  const lines = [header];
  const torture = [
    ';;;',
    'pas,de,bon,format,de,ligne,du,tout',
    '2026-01-01;1;OK',
    '01/02/03;-5,5;Année courte',
    '2026-06-15;-0,00;Montant nul',
    '2026-06-16;0,001;Très petit',
    '2026-06-17;-999999999,99;Énorme négatif',
    '2026-06-18;12 345,67;Espaces dans montant FR',
    '2026-06-19;\t-12,50\t;Tabs',
    '31/12/2025;100,00;Fin année',
    '2026-01-01;100,00;Doublon date',
    '2026-01-01;100,01;Doublon date 2',
  ];
  for (const t of torture) lines.push(t);
  for (let i = 0; i < 120; i++) lines.push(badRow(randomPick(['bad_date', 'bad_amount', 'no_date']), i));
  for (let i = 0; i < 80; i++) lines.push(validRow(2000 + i, i));
  return lines.join('\n') + '\n';
}

/** Scénarios métier : chaîne d'achat avec anomalies (référence tests manuels / IA) */
function buildPurchaseAnomalies() {
  const scenarios = [];

  const mk = (id, supplier, anomaly, steps) => ({
    scenarioId: id,
    fournisseur: supplier,
    anomalyDescription: anomaly,
    steps,
  });

  scenarios.push(
    mk(
      'ANOM-001',
      'Fournisseur Alpha',
      'Bon de livraison AVANT le bon de commande (dates incohérentes)',
      [
        { type: 'devis', date: '2026-03-10', reference: 'DDV-ANOM-001', montant: 1200 },
        { type: 'bon_livraison', date: '2026-03-01', reference: 'BL-ANOM-001', montant: null },
        { type: 'bon_commande', date: '2026-03-15', reference: 'BC-ANOM-001', montant: 1200 },
      ]
    ),
    mk(
      'ANOM-002',
      'Beta Industries',
      'Réception avant livraison',
      [
        { type: 'bon_commande', date: '2026-02-20', reference: 'BC-ANOM-002', montant: 500 },
        { type: 'bon_reception', date: '2026-02-18', reference: 'BR-ANOM-002', montant: null },
        { type: 'bon_livraison', date: '2026-02-25', reference: 'BL-ANOM-002', montant: null },
      ]
    ),
    mk(
      'ANOM-003',
      'Gamma SAS',
      'Facture avec montant différent du BC (écart)',
      [
        { type: 'bon_commande', date: '2026-04-01', reference: 'BC-ANOM-003', montant: 1000 },
        { type: 'facture', date: '2026-04-20', reference: 'FAC-ANOM-003', montant: 1750.5 },
      ]
    ),
    mk(
      'ANOM-004',
      'Delta Log',
      'Paiement (mouvement) avant facture',
      [
        { type: 'facture', date: '2026-05-10', reference: 'FAC-ANOM-004', montant: 800 },
        { type: 'mouvement', date: '2026-05-01', reference: 'VIR-DELTA', montant: 800, type_mouvement: 'sortie' },
      ]
    ),
    mk(
      'ANOM-005',
      'Epsilon',
      'Devis manquant, BC seul',
      [{ type: 'bon_commande', date: '2026-01-15', reference: 'BC-ORPHELIN', montant: 300 }]
    ),
    mk(
      'ANOM-006',
      'Zeta Corp',
      'Montants négatifs ou nuls sur documents',
      [
        { type: 'devis', date: '2026-06-01', reference: 'DDV-Z', montant: -100 },
        { type: 'facture', date: '2026-06-15', reference: 'FAC-Z', montant: 0 },
      ]
    ),
    mk(
      'ANOM-007',
      'Eta',
      'Même référence réutilisée sur deux fournisseurs (collision)',
      [
        { type: 'facture', date: '2026-07-01', reference: 'FAC-DUP', montant: 100, fournisseur: 'Eta' },
        { type: 'facture', date: '2026-07-02', reference: 'FAC-DUP', montant: 200, fournisseur: 'AutreCo' },
      ]
    ),
    mk(
      'ANOM-008',
      'Theta',
      'Date facture avant devis',
      [
        { type: 'facture', date: '2026-01-01', reference: 'FAC-EARLY', montant: 400 },
        { type: 'devis', date: '2026-02-01', reference: 'DDV-LATE', montant: 400 },
      ]
    ),
    mk(
      'ANOM-009',
      'Iota',
      'scenarioId manquant sur un document de la chaîne',
      [
        { type: 'bon_commande', date: '2026-08-10', reference: 'BC-I', montant: 50, scenarioId: 'S-IOTA' },
        { type: 'facture', date: '2026-08-20', reference: 'FAC-I', montant: 50, scenarioId: null },
      ]
    ),
    mk(
      'ANOM-010',
      'Kappa',
      'Livraison et commande même jour mais BL référence commande erronée',
      [
        { type: 'bon_commande', date: '2026-09-01', reference: 'BC-KAP-99', montant: 222 },
        { type: 'bon_livraison', date: '2026-09-05', reference: 'BL-KAP-WRONG', commandeRef: 'BC-OTHER', montant: null },
      ]
    )
  );

  // Génération massive de variantes
  for (let n = 11; n <= 55; n++) {
    const sid = `ANOM-${pad(n, 3)}`;
    const offset = n % 17;
    scenarios.push(
      mk(
        sid,
        `AutoVendor ${n}`,
        randomPick([
          'Écart progressif entre devis et facture',
          'Chronologie inversée sur un maillon',
          'Montant BC avec séparateur décimal ambigu',
          'Email de relance daté avant le devis',
        ]),
        [
          {
            type: 'devis',
            date: `2026-${pad((n % 12) + 1)}-${pad((offset % 27) + 1)}`,
            reference: `DDV-${sid}`,
            montant: 1000 + n * 13,
          },
          {
            type: 'bon_commande',
            date: `2026-${pad((n % 12) + 1)}-${pad((offset % 20) + 1)}`,
            reference: `BC-${sid}`,
            montant: 900 + n * 10,
          },
          {
            type: 'facture',
            date: `2026-${pad((n % 12) + 1)}-${pad(Math.max(1, offset - 3))}`,
            reference: `FAC-${sid}`,
            montant: 2000 + n * 20,
          },
        ]
      )
    );
  }

  return {
    meta: {
      purpose: 'Jeux de scénarios avec anomalies (dates, montants, références) — tests manuels, démo IA, frise',
      notLoadedByApi: true,
    },
    scenarios,
  };
}

function buildBulkMouvements(count = 200) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      montant: 50 + i * 0.25,
      date: `2026-${pad((i % 11) + 1)}-${pad((i % 27) + 1)}`,
      libelle: `Opération bulk ${i}`,
      type_mouvement: i % 2 ? 'sortie' : 'entree',
      reference: `BULK-${pad(i, 4)}`,
    });
  }
  return arr;
}

/** Exemples volontairement invalides pour tester la validation côté client (non représentatifs d’un bon bulk) */
function buildBulkInvalidExamples() {
  return {
    comment:
      'Ne pas poster tel quel si vous attendez des mouvements propres — pour tests erreurs API / UI',
    examples: [
      { montant: 'not-a-number', date: '2026-01-01', libelle: 'x', type_mouvement: 'sortie', reference: 'E1' },
      { montant: -500, date: 'invalid-date', libelle: 'bad date', type_mouvement: 'entree', reference: 'E2' },
      { montant: 0, date: '', libelle: '', type_mouvement: 'sortie', reference: '' },
      { montant: Number.NaN, date: '2026-06-01', libelle: 'NaN montant', type_mouvement: 'sortie', reference: 'E4' },
    ],
  };
}

function buildRapprochementFixtures() {
  return {
    meta: {
      purpose: 'Montants mouvement vs factures pour tests rapprochement (référence)',
    },
    cases: [
      { mouvementMontant: 1500, factures: [1500], expected: 'exact' },
      { mouvementMontant: 1500, factures: [800, 700], expected: 'exact' },
      { mouvementMontant: 1500, factures: [1000], expected: 'partial' },
      { mouvementMontant: 1500.01, factures: [1500], expected: 'écart 0.01' },
      { mouvementMontant: 0, factures: [100], expected: 'mouvement nul' },
      { mouvementMontant: 999999, factures: [1, 2, 3], expected: 'no_match probable' },
    ],
  };
}

function main() {
  ensureDir(OUT);
  ensureDir(IMG);

  fs.writeFileSync(path.join(IMG, 'pixel-1x1.png'), PNG_1X1);
  fs.writeFileSync(path.join(IMG, 'pixel-1x1.gif'), GIF_1X1);
  fs.writeFileSync(
    path.join(IMG, 'README.txt'),
    'Images minuscules pour tester un envoi de fichier non-PDF sur POST /documents/upload (attendu: erreur ou rejet).\n'
  );

  fs.writeFileSync(path.join(OUT, 'mouvements-stress.csv'), buildStressCsv(650), 'utf8');
  fs.writeFileSync(path.join(OUT, 'mouvements-stress-comma.csv'), buildStressCommaCsv(420), 'utf8');
  fs.writeFileSync(path.join(OUT, 'mouvements-parse-torture.csv'), buildParseTortureCsv(), 'utf8');

  fs.writeFileSync(
    path.join(OUT, 'scenarios-purchase-anomalies.json'),
    JSON.stringify(buildPurchaseAnomalies(), null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(OUT, 'mouvements-bulk-large.json'),
    JSON.stringify(buildBulkMouvements(250), null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(OUT, 'mouvements-bulk-invalid-examples.json'),
    JSON.stringify(buildBulkInvalidExamples(), null, 2),
    'utf8'
  );

  const purchase = buildPurchaseAnomalies();
  const summaryLines = [
    'scenarioId;fournisseur;anomaly;step_types;step_dates',
    ...purchase.scenarios.map((s) => {
      const types = s.steps.map((x) => x.type).join('|');
      const dates = s.steps.map((x) => x.date).join('|');
      return `${s.scenarioId};${s.fournisseur};${String(s.anomalyDescription).replace(/;/g, ',')};${types};${dates}`;
    }),
  ];
  fs.writeFileSync(path.join(OUT, 'scenarios-anomalies-summary.csv'), summaryLines.join('\n') + '\n', 'utf8');

  fs.writeFileSync(
    path.join(OUT, 'rapprochement-test-cases.json'),
    JSON.stringify(buildRapprochementFixtures(), null, 2),
    'utf8'
  );

  const timelineHints = {
    meta: {
      purpose: 'Événements fictifs pour valider tri / frise (hors API directe)',
    },
    globalOrderStress: Array.from({ length: 40 }, (_, i) => ({
      id: `evt-${i}`,
      type: randomPick(['mouvement', 'facture', 'bon_commande']),
      date: `2026-${pad((i % 12) + 1)}-${pad((i % 28) + 1)}`,
      scenarioId: `S-${(i % 5) + 1}`,
      reference: `REF-${i}`,
      montant: i % 3 === 0 ? null : i * 100,
    })),
  };
  fs.writeFileSync(path.join(OUT, 'timeline-mock-events.json'), JSON.stringify(timelineHints, null, 2), 'utf8');

  console.log('Written to', OUT);
  console.log('  mouvements-stress.csv, mouvements-stress-comma.csv, mouvements-parse-torture.csv');
  console.log('  scenarios-purchase-anomalies.json, scenarios-anomalies-summary.csv');
  console.log('  mouvements-bulk-large.json, mouvements-bulk-invalid-examples.json');
  console.log('  rapprochement-test-cases.json, timeline-mock-events.json');
  console.log('  images/pixel-1x1.png, images/pixel-1x1.gif');
}

main();
