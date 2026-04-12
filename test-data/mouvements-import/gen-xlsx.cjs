/**
 * Génère releve-sample.xlsx (nécessite: npx --yes -p xlsx node test-data/mouvements-import/gen-xlsx.cjs)
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const out = path.join(__dirname, 'releve-sample.xlsx');
const wb = XLSX.utils.book_new();
const rows = [
  ['Date', 'Montant', 'Libellé', 'Référence', 'Type'],
  ['2026-07-01', -200.5, 'ACHAT MATERIEL XLSX', 'XLSX-01', 'sortie'],
  ['2026-07-02', 3000, 'RECETTE PROJET', 'XLSX-02', 'entree'],
  ['2026-07-10', -45.99, 'PAIEMENT CB TEST', 'XLSX-03', 'sortie'],
];
const ws = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(wb, ws, 'Releve');
XLSX.writeFile(wb, out);
console.log('Wrote', out, fs.statSync(out).size, 'bytes');
