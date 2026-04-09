import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

// ─── SHARED SUPPLIERS & SCENARIOS ───
// Each scenario is a full chain: Devis → BC → BL → BR → Facture → Paiement
const scenarios = [
  {
    id: 'S01',
    fournisseur: 'SARL TechnoPlus', address: '15 Rue de l\'Innovation', city: '75011 Paris',
    siret: '412 345 678 00012', tva: 'FR12 412345678',
    client: 'Entreprise Client SARL', clientAddress: '456 Avenue des Affaires', clientCity: '69001 Lyon',
    items: [
      { description: 'Serveur Dell PowerEdge R750', qty: 1, unitHT: 4500.00 },
      { description: 'Licence Windows Server 2025', qty: 1, unitHT: 850.00 },
      { description: 'Installation et configuration', qty: 1, unitHT: 650.00 },
    ],
    dates: { devis: '2026-02-10', bc: '2026-02-15', bl: '2026-03-01', br: '2026-03-02', facture: '2026-03-03', paiement: '2026-03-15' },
  },
  {
    id: 'S02',
    fournisseur: 'ETS Durand & Fils', address: '8 Boulevard Haussmann', city: '75009 Paris',
    siret: '523 456 789 00023', tva: 'FR23 523456789',
    client: 'Entreprise Client SARL', clientAddress: '456 Avenue des Affaires', clientCity: '69001 Lyon',
    items: [
      { description: 'Bureau ergonomique 160x80cm', qty: 5, unitHT: 420.00 },
      { description: 'Fauteuil direction cuir', qty: 5, unitHT: 350.00 },
      { description: 'Caisson 3 tiroirs', qty: 5, unitHT: 120.00 },
      { description: 'Livraison et montage', qty: 1, unitHT: 450.00 },
    ],
    dates: { devis: '2026-02-05', bc: '2026-02-12', bl: '2026-02-28', br: '2026-03-01', facture: '2026-03-02', paiement: '2026-03-10' },
  },
  {
    id: 'S03',
    fournisseur: 'SARL CleanPro', address: '22 Rue de la Proprete', city: '69003 Lyon',
    siret: '634 567 890 00034', tva: 'FR34 634567890',
    client: 'Entreprise Client SARL', clientAddress: '456 Avenue des Affaires', clientCity: '69001 Lyon',
    items: [
      { description: 'Nettoyage bureaux 500m2 (mensuel)', qty: 3, unitHT: 625.00 },
      { description: 'Nettoyage vitres int/ext', qty: 1, unitHT: 380.00 },
      { description: 'Desinfection sanitaires (mensuel)', qty: 3, unitHT: 150.00 },
      { description: 'Produits d\'entretien (trimestre)', qty: 1, unitHT: 220.00 },
    ],
    dates: { devis: '2026-01-15', bc: '2026-01-20', bl: '2026-03-31', br: '2026-03-31', facture: '2026-04-01', paiement: '2026-04-10' },
  },
  {
    id: 'S04',
    fournisseur: 'SAS LogiTrans', address: 'Zone Industrielle Nord', city: '59000 Lille',
    siret: '745 678 901 00045', tva: 'FR45 745678901',
    client: 'Entreprise Client SARL', clientAddress: '456 Avenue des Affaires', clientCity: '69001 Lyon',
    items: [
      { description: 'Transport palette Paris-Lyon (lot)', qty: 4, unitHT: 280.00 },
      { description: 'Assurance marchandise', qty: 1, unitHT: 150.00 },
      { description: 'Emballage securise', qty: 4, unitHT: 35.00 },
    ],
    dates: { devis: '2026-02-20', bc: '2026-02-22', bl: '2026-03-05', br: '2026-03-06', facture: '2026-03-07', paiement: '2026-03-20' },
  },
  {
    id: 'S05',
    fournisseur: 'SAS FormaPro', address: '5 Place Bellecour', city: '69002 Lyon',
    siret: '856 789 012 00056', tva: 'FR56 856789012',
    client: 'Entreprise Client SARL', clientAddress: '456 Avenue des Affaires', clientCity: '69001 Lyon',
    items: [
      { description: 'Formation Cybersecurite (2 jours, 10 pers.)', qty: 1, unitHT: 2800.00 },
      { description: 'Support de cours et documentation', qty: 10, unitHT: 35.00 },
      { description: 'Certification individuelle', qty: 10, unitHT: 85.00 },
    ],
    dates: { devis: '2026-01-25', bc: '2026-02-01', bl: '2026-03-15', br: '2026-03-15', facture: '2026-03-16', paiement: '2026-03-30' },
  },
];

// ─── Email data ───
const emails = [
  // Related to scenarios
  { id: 'E01', scenarioId: 'S01', from: 'commercial@technoplus.fr', to: 'achats@client.fr', subject: 'Devis serveur Dell PowerEdge - ref DDV-S01', date: '2026-02-10', body: 'Bonjour,\n\nSuite a votre demande, veuillez trouver ci-joint notre devis pour la fourniture et l\'installation d\'un serveur Dell PowerEdge R750.\n\nNous restons a votre disposition.\n\nCordialement,\nService Commercial\nSARL TechnoPlus', hasRelation: true, relationType: 'devis' },
  { id: 'E02', scenarioId: 'S01', from: 'achats@client.fr', to: 'commercial@technoplus.fr', subject: 'RE: Devis serveur Dell PowerEdge - Bon de commande BC-S01', date: '2026-02-15', body: 'Bonjour,\n\nNous acceptons votre devis. Veuillez trouver ci-joint notre bon de commande BC-S01.\n\nMerci de confirmer la date de livraison.\n\nCordialement,\nService Achats\nEntreprise Client SARL', hasRelation: true, relationType: 'bon_commande' },
  { id: 'E03', scenarioId: 'S01', from: 'logistique@technoplus.fr', to: 'reception@client.fr', subject: 'Livraison serveur - BL-S01', date: '2026-03-01', body: 'Bonjour,\n\nVotre commande BC-S01 a ete expediee. Livraison prevue demain.\n\nBon de livraison BL-S01 en piece jointe.\n\nCordialement,\nService Logistique\nSARL TechnoPlus', hasRelation: true, relationType: 'bon_livraison' },
  { id: 'E04', scenarioId: 'S01', from: 'comptabilite@technoplus.fr', to: 'comptabilite@client.fr', subject: 'Facture FAC-S01 - Serveur Dell PowerEdge', date: '2026-03-03', body: 'Bonjour,\n\nVeuillez trouver ci-joint la facture FAC-S01 relative a votre commande BC-S01.\n\nReglement attendu sous 30 jours.\n\nCordialement,\nService Comptabilite\nSARL TechnoPlus', hasRelation: true, relationType: 'facture' },

  { id: 'E05', scenarioId: 'S02', from: 'ventes@durand-fils.fr', to: 'achats@client.fr', subject: 'Proposition mobilier de bureau', date: '2026-02-05', body: 'Bonjour,\n\nSuite a notre rencontre, voici notre proposition pour l\'amenagement de vos nouveaux bureaux.\n\nDevis DDV-S02 en piece jointe.\n\nCordialement,\nETS Durand & Fils', hasRelation: true, relationType: 'devis' },
  { id: 'E06', scenarioId: 'S02', from: 'achats@client.fr', to: 'ventes@durand-fils.fr', subject: 'Commande mobilier - BC-S02', date: '2026-02-12', body: 'Bonjour,\n\nNous validons votre devis. BC-S02 en PJ.\n\nMerci de confirmer le delai de livraison.\n\nCordialement,\nService Achats', hasRelation: true, relationType: 'bon_commande' },

  { id: 'E07', scenarioId: 'S03', from: 'contact@cleanpro.fr', to: 'services@client.fr', subject: 'Contrat nettoyage Q1 2026', date: '2026-01-15', body: 'Bonjour,\n\nVeuillez trouver notre devis pour le nettoyage de vos locaux au premier trimestre 2026.\n\nCordialement,\nSARL CleanPro', hasRelation: true, relationType: 'devis' },

  { id: 'E08', scenarioId: 'S05', from: 'formation@formapro.fr', to: 'rh@client.fr', subject: 'Formation cybersecurite - Planning', date: '2026-02-01', body: 'Bonjour,\n\nNous confirmons la formation cybersecurite pour 10 collaborateurs les 14 et 15 mars 2026.\n\nDevis et programme en PJ.\n\nCordialement,\nSAS FormaPro', hasRelation: true, relationType: 'devis' },

  // NOT related to any transaction
  { id: 'E09', scenarioId: null, from: 'newsletter@techmagazine.fr', to: 'info@client.fr', subject: 'Les tendances IT 2026 - Newsletter Mars', date: '2026-03-01', body: 'Decouvrez les tendances technologiques de 2026 : IA generative, cloud souverain, cybersecurite...\n\nLire la suite sur techmagazine.fr', hasRelation: false, relationType: null },
  { id: 'E10', scenarioId: null, from: 'rh@client.fr', to: 'all@client.fr', subject: 'Rappel: Reunion d\'equipe vendredi 14h', date: '2026-03-10', body: 'Bonjour a tous,\n\nRappel de la reunion d\'equipe ce vendredi a 14h en salle Confluence.\n\nOrdre du jour:\n- Bilan Q1\n- Objectifs Q2\n- Questions diverses\n\nMerci de confirmer votre presence.', hasRelation: false, relationType: null },
  { id: 'E11', scenarioId: null, from: 'support@cloudprovider.com', to: 'admin@client.fr', subject: 'Maintenance planifiee - 20 mars 2026', date: '2026-03-15', body: 'Dear customer,\n\nA planned maintenance will occur on March 20, 2026 from 02:00 to 06:00 CET.\n\nSome services may be temporarily unavailable.\n\nBest regards,\nCloud Provider Support', hasRelation: false, relationType: null },
  { id: 'E12', scenarioId: null, from: 'direction@client.fr', to: 'all@client.fr', subject: 'Bonne nouvelle: Nouveau client signe!', date: '2026-03-20', body: 'Chers collaborateurs,\n\nJ\'ai le plaisir de vous annoncer la signature d\'un contrat majeur avec le groupe Alpha.\n\nBravo a toute l\'equipe commerciale!\n\nLa Direction', hasRelation: false, relationType: null },
];

// ─── HELPER: Compute totals ───
function computeTotals(items: { qty: number; unitHT: number }[]) {
  const totalHT = items.reduce((sum, i) => sum + +(i.qty * i.unitHT).toFixed(2), 0);
  const tva = +(totalHT * 0.2).toFixed(2);
  const ttc = +(totalHT + tva).toFixed(2);
  return { totalHT: +totalHT.toFixed(2), tva, ttc };
}

// ─── PDF GENERATORS ───

function drawHeader(doc: PDFKit.PDFDocument, s: typeof scenarios[0], docType: string, ref: string, date: string) {
  doc.fontSize(11).font('Helvetica-Bold').text(s.fournisseur, 50, 50);
  doc.fontSize(9).font('Helvetica');
  doc.text(s.address, 50, 65);
  doc.text(s.city, 50, 77);
  doc.text(`SIRET: ${s.siret}`, 50, 89);
  doc.text(`TVA: ${s.tva}`, 50, 101);

  doc.moveDown(2);
  doc.fontSize(22).font('Helvetica-Bold').text(docType, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica').text(`N\u00b0 ${ref}`, { align: 'center' });

  doc.moveDown(1.5);
  doc.fontSize(10);
  doc.text(`Date : ${date}`, 50);

  doc.moveDown(1);
  doc.font('Helvetica-Bold').text('Destinataire :', 350, doc.y - 15);
  doc.font('Helvetica');
  doc.text(s.client, 350);
  doc.text(s.clientAddress, 350);
  doc.text(s.clientCity, 350);
}

function drawItemsTable(doc: PDFKit.PDFDocument, items: typeof scenarios[0]['items'], totals: { totalHT: number; tva: number; ttc: number }) {
  const colDesc = 50, colQty = 310, colUnit = 365, colHT = 430, colTTC = 495;

  let y = doc.y + 25;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1.5).stroke();
  y += 8;

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Description', colDesc, y, { width: 250 });
  doc.text('Qte', colQty, y, { width: 40, align: 'center' });
  doc.text('P.U. HT', colUnit, y, { width: 55, align: 'right' });
  doc.text('Total HT', colHT, y, { width: 55, align: 'right' });
  doc.text('Total TTC', colTTC, y, { width: 55, align: 'right' });
  y += 16;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke();
  y += 8;

  doc.font('Helvetica').fontSize(9);
  for (const item of items) {
    const lineHT = +(item.qty * item.unitHT).toFixed(2);
    const lineTTC = +(lineHT * 1.2).toFixed(2);
    doc.text(item.description, colDesc, y, { width: 250 });
    doc.text(String(item.qty), colQty, y, { width: 40, align: 'center' });
    doc.text(item.unitHT.toFixed(2), colUnit, y, { width: 55, align: 'right' });
    doc.text(lineHT.toFixed(2), colHT, y, { width: 55, align: 'right' });
    doc.text(lineTTC.toFixed(2), colTTC, y, { width: 55, align: 'right' });
    y += 18;
  }

  y += 5;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke();
  y += 15;

  doc.font('Helvetica').fontSize(10);
  doc.text('Total HT :', 380, y, { width: 70, align: 'right' });
  doc.text(`${totals.totalHT.toFixed(2)} EUR`, 485, y, { width: 70, align: 'right' });
  y += 18;
  doc.text('TVA (20%) :', 380, y, { width: 70, align: 'right' });
  doc.text(`${totals.tva.toFixed(2)} EUR`, 485, y, { width: 70, align: 'right' });
  y += 18;
  doc.moveTo(380, y).lineTo(555, y).lineWidth(1).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(13);
  doc.text('TOTAL TTC :', 370, y, { width: 80, align: 'right' });
  doc.text(`${totals.ttc.toFixed(2)} EUR`, 465, y, { width: 90, align: 'right' });

  return y;
}

function drawFooter(doc: PDFKit.PDFDocument, fournisseur: string) {
  doc.font('Helvetica').fontSize(7);
  doc.text(`${fournisseur} - Document genere automatiquement`, 50, 755, { align: 'center', width: 495 });
}

function writePDF(doc: PDFKit.PDFDocument, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ── Demande de devis ──
async function genDevis(s: typeof scenarios[0], outDir: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const ref = `DDV-${s.id}`;
  const totals = computeTotals(s.items);

  drawHeader(doc, s, 'DEMANDE DE DEVIS', ref, s.dates.devis);

  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica');
  doc.text('Nous souhaitons recevoir un devis pour les prestations/fournitures suivantes :', 50);

  drawItemsTable(doc, s.items, totals);

  doc.font('Helvetica').fontSize(9);
  doc.text('Merci de nous retourner votre meilleure offre sous 15 jours.', 50, 680);
  doc.text(`Validite du devis : 30 jours a compter du ${s.dates.devis}`, 50, 695);

  drawFooter(doc, s.fournisseur);
  await writePDF(doc, path.join(outDir, `${ref}.pdf`));
  return { ref, type: 'devis', montant: totals.ttc };
}

// ── Bon de commande ──
async function genBonCommande(s: typeof scenarios[0], outDir: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const ref = `BC-${s.id}`;
  const totals = computeTotals(s.items);

  drawHeader(doc, s, 'BON DE COMMANDE', ref, s.dates.bc);

  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Reference devis : DDV-${s.id}`, 50);
  doc.text(`Date de livraison souhaitee : ${s.dates.bl}`, 50);

  drawItemsTable(doc, s.items, totals);

  doc.font('Helvetica').fontSize(9);
  doc.text('Conditions de paiement : 30 jours fin de mois', 50, 660);
  doc.text('Mode de reglement : Virement bancaire', 50, 672);
  doc.text('IBAN : FR76 3000 6000 0112 3456 7890 189 | BIC : AGRIFRPP', 50, 684);

  drawFooter(doc, s.client);
  await writePDF(doc, path.join(outDir, `${ref}.pdf`));
  return { ref, type: 'bon_commande', montant: totals.ttc };
}

// ── Bon de livraison ──
async function genBonLivraison(s: typeof scenarios[0], outDir: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const ref = `BL-${s.id}`;

  drawHeader(doc, s, 'BON DE LIVRAISON', ref, s.dates.bl);

  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Bon de commande : BC-${s.id}`, 50);
  doc.text(`Transporteur : Express Fret National`, 50);
  doc.text(`Mode de livraison : Livraison sur site`, 50);

  // Items without prices
  const colDesc = 50, colQty = 350, colObs = 420;
  let y = doc.y + 25;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1.5).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Description', colDesc, y, { width: 280 });
  doc.text('Qte livree', colQty, y, { width: 60, align: 'center' });
  doc.text('Observation', colObs, y, { width: 120 });
  y += 16;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke();
  y += 8;

  doc.font('Helvetica').fontSize(9);
  for (const item of s.items) {
    doc.text(item.description, colDesc, y, { width: 280 });
    doc.text(String(item.qty), colQty, y, { width: 60, align: 'center' });
    doc.text('Conforme', colObs, y, { width: 120 });
    y += 18;
  }

  y += 20;
  doc.text('Signature du livreur : ____________________', 50, y);
  doc.text('Signature du receptionnaire : ____________________', 300, y);
  y += 30;
  doc.text(`Nombre de colis : ${s.items.length}`, 50, y);
  doc.text('Etat general : Bon etat', 50, y + 15);

  drawFooter(doc, s.fournisseur);
  await writePDF(doc, path.join(outDir, `${ref}.pdf`));
  return { ref, type: 'bon_livraison' };
}

// ── Bon de réception ──
async function genBonReception(s: typeof scenarios[0], outDir: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const ref = `BR-${s.id}`;

  drawHeader(doc, s, 'BON DE RECEPTION', ref, s.dates.br);

  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Bon de commande : BC-${s.id}`, 50);
  doc.text(`Bon de livraison : BL-${s.id}`, 50);
  doc.text(`Date de reception : ${s.dates.br}`, 50);

  const colDesc = 50, colCmd = 280, colRcv = 350, colConf = 420;
  let y = doc.y + 25;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1.5).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Description', colDesc, y, { width: 220 });
  doc.text('Qte cmd', colCmd, y, { width: 55, align: 'center' });
  doc.text('Qte recue', colRcv, y, { width: 55, align: 'center' });
  doc.text('Conformite', colConf, y, { width: 120 });
  y += 16;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke();
  y += 8;

  doc.font('Helvetica').fontSize(9);
  for (const item of s.items) {
    doc.text(item.description, colDesc, y, { width: 220 });
    doc.text(String(item.qty), colCmd, y, { width: 55, align: 'center' });
    doc.text(String(item.qty), colRcv, y, { width: 55, align: 'center' });
    doc.text('OK - Conforme', colConf, y, { width: 120 });
    y += 18;
  }

  y += 20;
  doc.font('Helvetica-Bold');
  doc.text('Conclusion : Reception conforme a la commande.', 50, y);
  y += 25;
  doc.font('Helvetica');
  doc.text('Responsable reception : ____________________', 50, y);
  doc.text(`Date : ${s.dates.br}`, 350, y);

  drawFooter(doc, s.client);
  await writePDF(doc, path.join(outDir, `${ref}.pdf`));
  return { ref, type: 'bon_reception' };
}

// ── Facture ──
async function genFacture(s: typeof scenarios[0], outDir: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const ref = `FAC-${s.id}`;
  const totals = computeTotals(s.items);

  drawHeader(doc, s, 'FACTURE', ref, s.dates.facture);

  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Bon de commande : BC-${s.id}`, 50);
  doc.text(`Bon de livraison : BL-${s.id}`, 50);

  const endY = drawItemsTable(doc, s.items, totals);

  const payY = endY + 40;
  doc.font('Helvetica').fontSize(9);
  doc.text('Conditions de paiement : 30 jours fin de mois', 50, payY);
  doc.text('Mode de reglement : Virement bancaire', 50, payY + 12);
  doc.text('IBAN : FR76 3000 6000 0112 3456 7890 189 | BIC : AGRIFRPP', 50, payY + 24);

  drawFooter(doc, s.fournisseur);
  await writePDF(doc, path.join(outDir, `${ref}.pdf`));
  return { ref, type: 'facture', montant: totals.ttc };
}

// ── Email PDF ──
async function genEmailPDF(email: typeof emails[0], outDir: string) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  // Email header style
  doc.rect(50, 50, 495, 100).fill('#f1f5f9');
  doc.fill('#1e293b');
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('De :', 60, 60); doc.font('Helvetica').text(email.from, 110, 60);
  doc.font('Helvetica-Bold').text('A :', 60, 75); doc.font('Helvetica').text(email.to, 110, 75);
  doc.font('Helvetica-Bold').text('Date :', 60, 90); doc.font('Helvetica').text(email.date, 110, 90);
  doc.font('Helvetica-Bold').text('Objet :', 60, 105); doc.font('Helvetica').text(email.subject, 110, 105);

  if (email.hasRelation) {
    doc.font('Helvetica-Bold').text('Relation :', 350, 60);
    doc.font('Helvetica').text(email.relationType || '', 410, 60);
    doc.text(`Scenario : ${email.scenarioId}`, 350, 75);
  } else {
    doc.fontSize(8).font('Helvetica').fillColor('#94a3b8').text('Aucune relation commerciale', 350, 60);
    doc.fillColor('#1e293b');
  }

  // Body
  doc.moveDown(4);
  doc.fontSize(11).font('Helvetica');
  doc.text(email.body, 60, 180, { width: 475, lineGap: 4 });

  drawFooter(doc, 'Email Archive');
  await writePDF(doc, path.join(outDir, `EMAIL-${email.id}.pdf`));
  return { ref: `EMAIL-${email.id}`, type: 'email' };
}

// ─── MAIN ───
export async function generateAllDocuments() {
  const baseDir = path.join(__dirname, '..', 'seed-documents');
  const dirs = {
    devis: path.join(baseDir, 'devis'),
    bc: path.join(baseDir, 'bons-commande'),
    bl: path.join(baseDir, 'bons-livraison'),
    br: path.join(baseDir, 'bons-reception'),
    factures: path.join(baseDir, 'factures'),
    emails: path.join(baseDir, 'emails'),
  };

  // Create directories
  for (const dir of Object.values(dirs)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  console.log('\n--- Generating all documents ---');

  const allDocs: { scenarioId: string; ref: string; type: string; montant?: number; date: string }[] = [];

  for (const s of scenarios) {
    console.log(`\n[Scenario ${s.id}] ${s.fournisseur}`);
    const totals = computeTotals(s.items);

    const devis = await genDevis(s, dirs.devis);
    console.log(`  DDV-${s.id}.pdf (Demande de devis) | ${totals.ttc.toFixed(2)} EUR`);
    allDocs.push({ scenarioId: s.id, ...devis, date: s.dates.devis });

    const bc = await genBonCommande(s, dirs.bc);
    console.log(`  BC-${s.id}.pdf  (Bon de commande)  | ${totals.ttc.toFixed(2)} EUR`);
    allDocs.push({ scenarioId: s.id, ...bc, date: s.dates.bc });

    const bl = await genBonLivraison(s, dirs.bl);
    console.log(`  BL-${s.id}.pdf  (Bon de livraison)`);
    allDocs.push({ scenarioId: s.id, ...bl, date: s.dates.bl });

    const br = await genBonReception(s, dirs.br);
    console.log(`  BR-${s.id}.pdf  (Bon de reception)`);
    allDocs.push({ scenarioId: s.id, ...br, date: s.dates.br });

    const fac = await genFacture(s, dirs.factures);
    console.log(`  FAC-${s.id}.pdf (Facture)          | ${totals.ttc.toFixed(2)} EUR`);
    allDocs.push({ scenarioId: s.id, ...fac, date: s.dates.facture });
  }

  console.log('\n--- Generating emails ---');
  for (const email of emails) {
    await genEmailPDF(email, dirs.emails);
    const tag = email.hasRelation ? `[${email.relationType} - ${email.scenarioId}]` : '[pas de relation]';
    console.log(`  EMAIL-${email.id}.pdf | ${email.subject.substring(0, 50)}... ${tag}`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`${scenarios.length} scenarios x 5 documents = ${scenarios.length * 5} PDFs`);
  console.log(`${emails.length} emails (${emails.filter(e => e.hasRelation).length} lies, ${emails.filter(e => !e.hasRelation).length} sans relation)`);
  console.log(`Output: ${baseDir}`);

  return { scenarios, emails, allDocs };
}

// Allow standalone run
if (require.main === module) {
  generateAllDocuments().then(() => {
    console.log('\nDone!');
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
