const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'test-documents');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function write(doc, filePath) {
  return new Promise((resolve, reject) => {
    const s = fs.createWriteStream(filePath);
    doc.pipe(s);
    doc.end();
    s.on('finish', resolve);
    s.on('error', reject);
  });
}

// ── TEST DEVIS ──
async function genDevis() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(11).font('Helvetica-Bold').text('SAS Mobilier Pro', 50, 50);
  doc.fontSize(9).font('Helvetica');
  doc.text('22 Rue du Meuble', 50, 65);
  doc.text('33000 Bordeaux, France', 50, 77);
  doc.text('SIRET: 789 456 123 00067', 50, 89);

  doc.moveDown(2);
  doc.fontSize(22).font('Helvetica-Bold').text('DEMANDE DE DEVIS', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica').text('N\u00b0 DDV-TEST-001', { align: 'center' });

  doc.moveDown(1.5);
  doc.fontSize(10);
  doc.text('Date : 2026-04-01', 50);
  doc.text('Validite : 30 jours', 50);

  doc.moveDown(1);
  doc.font('Helvetica-Bold').text('Destinataire :', 350, doc.y - 15);
  doc.font('Helvetica');
  doc.text('Entreprise Test SARL', 350);
  doc.text('10 Rue du Test', 350);
  doc.text('75001 Paris', 350);

  doc.moveDown(2);
  doc.text('Nous souhaitons recevoir un devis pour les fournitures suivantes :', 50);

  const items = [
    { desc: 'Chaise de bureau ergonomique', qty: 10, pu: 250 },
    { desc: 'Rehausseur ecran ajustable', qty: 10, pu: 45 },
    { desc: 'Tapis de souris XXL', qty: 10, pu: 15 },
  ];

  let y = doc.y + 20;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1).stroke(); y += 8;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Description', 50, y); doc.text('Qte', 320, y); doc.text('P.U. HT', 380, y); doc.text('Total HT', 460, y);
  y += 16; doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke(); y += 8;
  doc.font('Helvetica');
  let totalHT = 0;
  for (const i of items) {
    const line = i.qty * i.pu;
    totalHT += line;
    doc.text(i.desc, 50, y); doc.text(String(i.qty), 330, y); doc.text(i.pu.toFixed(2), 380, y); doc.text(line.toFixed(2), 460, y);
    y += 18;
  }
  y += 10;
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text(`Total HT : ${totalHT.toFixed(2)} EUR`, 380, y);
  doc.text(`TTC : ${(totalHT * 1.2).toFixed(2)} EUR`, 380, y + 18);

  doc.font('Helvetica').fontSize(9);
  doc.text('Merci de nous retourner votre meilleure offre.', 50, 700);
  doc.text('SAS Mobilier Pro - Document genere pour test', 50, 755, { align: 'center', width: 495 });
  await write(doc, path.join(outDir, 'DDV-TEST-001.pdf'));
}

// ── TEST BON DE COMMANDE ──
async function genBC() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(11).font('Helvetica-Bold').text('Entreprise Test SARL', 50, 50);
  doc.fontSize(9).font('Helvetica');
  doc.text('10 Rue du Test', 50, 65);
  doc.text('75001 Paris', 50, 77);

  doc.moveDown(2);
  doc.fontSize(22).font('Helvetica-Bold').text('BON DE COMMANDE', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica').text('N\u00b0 BC-TEST-001', { align: 'center' });

  doc.moveDown(1.5);
  doc.fontSize(10);
  doc.text('Date : 2026-04-03', 50);
  doc.text('Reference devis : DDV-TEST-001', 50);
  doc.text('Date livraison souhaitee : 2026-04-15', 50);

  doc.moveDown(1);
  doc.font('Helvetica-Bold').text('Fournisseur :', 350, doc.y - 30);
  doc.font('Helvetica');
  doc.text('SAS Mobilier Pro', 350);
  doc.text('22 Rue du Meuble', 350);
  doc.text('33000 Bordeaux', 350);

  const items = [
    { desc: 'Chaise de bureau ergonomique', qty: 10, pu: 250 },
    { desc: 'Rehausseur ecran ajustable', qty: 10, pu: 45 },
    { desc: 'Tapis de souris XXL', qty: 10, pu: 15 },
  ];

  let y = doc.y + 25;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1).stroke(); y += 8;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Description', 50, y); doc.text('Qte', 320, y); doc.text('P.U. HT', 380, y); doc.text('Total TTC', 460, y);
  y += 16; doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke(); y += 8;
  doc.font('Helvetica');
  let total = 0;
  for (const i of items) {
    const line = i.qty * i.pu * 1.2;
    total += line;
    doc.text(i.desc, 50, y); doc.text(String(i.qty), 330, y); doc.text(i.pu.toFixed(2), 380, y); doc.text(line.toFixed(2), 460, y);
    y += 18;
  }
  y += 10;
  doc.font('Helvetica-Bold').fontSize(13);
  doc.text(`TOTAL TTC : ${total.toFixed(2)} EUR`, 380, y);

  doc.font('Helvetica').fontSize(9);
  doc.text('Conditions : Paiement 30 jours', 50, 680);
  doc.text('IBAN : FR76 3000 6000 0112 3456 7890 189', 50, 692);
  await write(doc, path.join(outDir, 'BC-TEST-001.pdf'));
}

// ── TEST BON DE LIVRAISON ──
async function genBL() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(11).font('Helvetica-Bold').text('SAS Mobilier Pro', 50, 50);
  doc.fontSize(9).font('Helvetica');
  doc.text('22 Rue du Meuble, 33000 Bordeaux', 50, 65);

  doc.moveDown(2);
  doc.fontSize(22).font('Helvetica-Bold').text('BON DE LIVRAISON', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica').text('N\u00b0 BL-TEST-001', { align: 'center' });

  doc.moveDown(1.5);
  doc.fontSize(10);
  doc.text('Date de livraison : 2026-04-14', 50);
  doc.text('Bon de commande : BC-TEST-001', 50);
  doc.text('Transporteur : Chronopost', 50);

  doc.moveDown(1);
  doc.font('Helvetica-Bold').text('Destinataire :', 350, doc.y - 15);
  doc.font('Helvetica');
  doc.text('Entreprise Test SARL', 350);
  doc.text('10 Rue du Test, 75001 Paris', 350);

  const items = ['Chaise de bureau ergonomique x10', 'Rehausseur ecran ajustable x10', 'Tapis de souris XXL x10'];
  let y = doc.y + 25;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1).stroke(); y += 8;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Article', 50, y); doc.text('Qte livree', 350, y); doc.text('Observation', 440, y);
  y += 16; doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke(); y += 8;
  doc.font('Helvetica');
  for (const item of items) {
    doc.text(item, 50, y); doc.text('Conforme', 355, y); doc.text('OK', 450, y);
    y += 18;
  }
  y += 25;
  doc.text('Nombre de colis : 3', 50, y);
  doc.text('Etat : Bon etat, emballage intact', 50, y + 15);
  y += 40;
  doc.text('Signature livreur : ____________________', 50, y);
  doc.text('Signature receptionnaire : ____________________', 300, y);
  await write(doc, path.join(outDir, 'BL-TEST-001.pdf'));
}

// ── TEST BON DE RECEPTION ──
async function genBR() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(11).font('Helvetica-Bold').text('Entreprise Test SARL', 50, 50);
  doc.fontSize(9).font('Helvetica');
  doc.text('10 Rue du Test, 75001 Paris', 50, 65);

  doc.moveDown(2);
  doc.fontSize(22).font('Helvetica-Bold').text('BON DE RECEPTION', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica').text('N\u00b0 BR-TEST-001', { align: 'center' });

  doc.moveDown(1.5);
  doc.fontSize(10);
  doc.text('Date de reception : 2026-04-14', 50);
  doc.text('Bon de commande : BC-TEST-001', 50);
  doc.text('Bon de livraison : BL-TEST-001', 50);

  const items = [
    { desc: 'Chaise de bureau ergonomique', cmd: 10, recv: 10 },
    { desc: 'Rehausseur ecran ajustable', cmd: 10, recv: 10 },
    { desc: 'Tapis de souris XXL', cmd: 10, recv: 10 },
  ];
  let y = doc.y + 25;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1).stroke(); y += 8;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Article', 50, y); doc.text('Qte cmd', 300, y); doc.text('Qte recue', 370, y); doc.text('Conformite', 450, y);
  y += 16; doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke(); y += 8;
  doc.font('Helvetica');
  for (const i of items) {
    doc.text(i.desc, 50, y); doc.text(String(i.cmd), 315, y); doc.text(String(i.recv), 385, y); doc.text('OK - Conforme', 450, y);
    y += 18;
  }
  y += 25;
  doc.font('Helvetica-Bold');
  doc.text('Conclusion : Reception conforme a la commande.', 50, y);
  y += 20;
  doc.font('Helvetica');
  doc.text('Responsable : Jean Dupont', 50, y);
  doc.text('Date : 2026-04-14', 300, y);
  await write(doc, path.join(outDir, 'BR-TEST-001.pdf'));
}

// ── TEST EMAIL ──
async function genEmail() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.rect(50, 50, 495, 100).fill('#f1f5f9');
  doc.fill('#1e293b');
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('De :', 60, 60); doc.font('Helvetica').text('commercial@mobilier-pro.fr', 100, 60);
  doc.font('Helvetica-Bold').text('A :', 60, 75); doc.font('Helvetica').text('achats@test-sarl.fr', 100, 75);
  doc.font('Helvetica-Bold').text('Date :', 60, 90); doc.font('Helvetica').text('2026-04-02', 100, 90);
  doc.font('Helvetica-Bold').text('Objet :', 60, 105); doc.font('Helvetica').text('Suite a votre demande de devis DDV-TEST-001', 100, 105);

  doc.moveDown(5);
  doc.fontSize(11).font('Helvetica');
  doc.text('Bonjour,\n\nSuite a votre demande, nous avons le plaisir de vous transmettre notre devis DDV-TEST-001 pour la fourniture de mobilier de bureau.\n\nVous trouverez ci-joint notre proposition detaillee.\n\nNous restons a votre disposition pour toute question.\n\nCordialement,\nService Commercial\nSAS Mobilier Pro\nTel: 05 56 00 00 00', 60, 180, { width: 475, lineGap: 4 });

  doc.font('Helvetica').fontSize(7);
  doc.text('Email archive - Document genere pour test', 50, 755, { align: 'center', width: 495 });
  await write(doc, path.join(outDir, 'EMAIL-TEST-001.pdf'));
}

// ── TEST EMAIL (no relation) ──
async function genEmailNoRelation() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.rect(50, 50, 495, 100).fill('#f1f5f9');
  doc.fill('#1e293b');
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('De :', 60, 60); doc.font('Helvetica').text('rh@test-sarl.fr', 100, 60);
  doc.font('Helvetica-Bold').text('A :', 60, 75); doc.font('Helvetica').text('all@test-sarl.fr', 100, 75);
  doc.font('Helvetica-Bold').text('Date :', 60, 90); doc.font('Helvetica').text('2026-04-05', 100, 90);
  doc.font('Helvetica-Bold').text('Objet :', 60, 105); doc.font('Helvetica').text('Team building vendredi prochain', 100, 105);

  doc.moveDown(5);
  doc.fontSize(11).font('Helvetica');
  doc.text('Bonjour a tous,\n\nNous organisons un team building vendredi prochain a partir de 14h.\n\nAu programme :\n- Escape game\n- Bowling\n- Diner d\'equipe\n\nMerci de confirmer votre presence avant mercredi.\n\nCordialement,\nService RH', 60, 180, { width: 475, lineGap: 4 });

  await write(doc, path.join(outDir, 'EMAIL-TEST-002.pdf'));
}

async function main() {
  await genDevis();   console.log('DDV-TEST-001.pdf  (Devis)');
  await genBC();      console.log('BC-TEST-001.pdf   (Bon de commande)');
  await genBL();      console.log('BL-TEST-001.pdf   (Bon de livraison)');
  await genBR();      console.log('BR-TEST-001.pdf   (Bon de reception)');
  await genEmail();   console.log('EMAIL-TEST-001.pdf (Email avec relation)');
  await genEmailNoRelation(); console.log('EMAIL-TEST-002.pdf (Email sans relation)');
  console.log(`\n8 test documents in: ${outDir}`);
  console.log('- 3 factures (FAC-TEST-001/002/003)');
  console.log('- 1 devis (DDV-TEST-001)');
  console.log('- 1 bon de commande (BC-TEST-001)');
  console.log('- 1 bon de livraison (BL-TEST-001)');
  console.log('- 1 bon de reception (BR-TEST-001)');
  console.log('- 2 emails (EMAIL-TEST-001 with relation, EMAIL-TEST-002 without)');
}

main().catch(console.error);
