import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import redis from './services/redis.service';

// ─── 20 MOUVEMENTS ───
const mouvements = [
  // CASE 1-5: Exact match (1 mouvement = 1 facture, same amount)
  { montant: 1500.00, date: '2026-03-01', libelle: 'VIR SARL TechnoPlus - Maintenance serveur', type_mouvement: 'sortie', reference: 'VIR-2026-001' },
  { montant: 2340.50, date: '2026-03-03', libelle: 'VIR ETS Durand & Fils - Materiel bureau', type_mouvement: 'sortie', reference: 'VIR-2026-002' },
  { montant: 890.00, date: '2026-03-05', libelle: 'VIR SAS Bureau Express - Papeterie', type_mouvement: 'sortie', reference: 'VIR-2026-003' },
  { montant: 4200.00, date: '2026-03-07', libelle: 'VIR SARL NetServices - Abonnement cloud', type_mouvement: 'sortie', reference: 'VIR-2026-004' },
  { montant: 675.30, date: '2026-03-10', libelle: 'VIR ETS Martin Fournitures - Consommables', type_mouvement: 'sortie', reference: 'VIR-2026-005' },

  // CASE 6-8: Split (1 mouvement = 2 factures whose sum = mouvement amount)
  { montant: 3000.00, date: '2026-03-12', libelle: 'VIR SAS LogiTrans - Transport mars', type_mouvement: 'sortie', reference: 'VIR-2026-006' },
  { montant: 5500.00, date: '2026-03-14', libelle: 'VIR SARL CleanPro - Nettoyage trimestre', type_mouvement: 'sortie', reference: 'VIR-2026-007' },
  { montant: 1800.00, date: '2026-03-16', libelle: 'VIR ETS Garage Central - Entretien vehicules', type_mouvement: 'sortie', reference: 'VIR-2026-008' },

  // CASE 9-11: Partial match (factures don't cover 100% of mouvement)
  { montant: 2500.00, date: '2026-03-18', libelle: 'VIR SAS FormaPro - Formation equipe', type_mouvement: 'sortie', reference: 'VIR-2026-009' },
  { montant: 7800.00, date: '2026-03-20', libelle: 'VIR SARL Securitas Plus - Securite annuelle', type_mouvement: 'sortie', reference: 'VIR-2026-010' },
  { montant: 3200.00, date: '2026-03-22', libelle: 'VIR ETS Elec Industrie - Electricite', type_mouvement: 'sortie', reference: 'VIR-2026-011' },

  // CASE 12-14: No matching facture at all
  { montant: 450.00, date: '2026-03-24', libelle: 'VIR Divers - Frais bancaires', type_mouvement: 'sortie', reference: 'VIR-2026-012' },
  { montant: 1200.00, date: '2026-03-25', libelle: 'PRLV Assurance Locaux', type_mouvement: 'sortie', reference: 'VIR-2026-013' },
  { montant: 320.00, date: '2026-03-26', libelle: 'CB Fournitures diverses', type_mouvement: 'sortie', reference: 'VIR-2026-014' },

  // CASE 15-17: Entrees (income) - skipped by reconciliation
  { montant: 15000.00, date: '2026-03-02', libelle: 'VIR Client Alpha - Paiement projet', type_mouvement: 'entree', reference: 'VIR-2026-E01' },
  { montant: 8500.00, date: '2026-03-10', libelle: 'VIR Client Beta - Acompte', type_mouvement: 'entree', reference: 'VIR-2026-E02' },
  { montant: 22000.00, date: '2026-03-20', libelle: 'VIR Client Gamma - Solde contrat', type_mouvement: 'entree', reference: 'VIR-2026-E03' },

  // CASE 18-20: Edge cases
  { montant: 999.99, date: '2026-03-28', libelle: 'VIR SAS AquaPure - Fontaines eau', type_mouvement: 'sortie', reference: 'VIR-2026-015' },
  { montant: 1500.00, date: '2026-03-29', libelle: 'VIR SARL TechnoPlus - Maintenance serveur avril', type_mouvement: 'sortie', reference: 'VIR-2026-016' },
  { montant: 6100.00, date: '2026-03-30', libelle: 'VIR ETS Durand & Fils - Mobilier', type_mouvement: 'sortie', reference: 'VIR-2026-017' },
];

// ─── 26 FACTURES WITH DETAILED ITEMS ───
interface LineItem {
  description: string;
  qty: number;
  unitPriceHT: number;
}

interface FactureDef {
  montant: number; // TTC total
  date: string;
  fournisseur: string;
  reference: string;
  items: LineItem[];
}

const factures: FactureDef[] = [
  // ── Exact matches for mouvements 1-5 ──
  {
    montant: 1500.00, date: '2026-02-28', fournisseur: 'SARL TechnoPlus', reference: 'FAC-2026-001',
    items: [
      { description: 'Maintenance preventive serveur principal', qty: 1, unitPriceHT: 450.00 },
      { description: 'Mise a jour firmware switches reseau', qty: 2, unitPriceHT: 150.00 },
      { description: 'Sauvegarde et verification backup mensuel', qty: 1, unitPriceHT: 250.00 },
      { description: 'Remplacement disque dur SSD 1To', qty: 1, unitPriceHT: 250.00 },
    ],
  },
  {
    montant: 2340.50, date: '2026-03-01', fournisseur: 'ETS Durand & Fils', reference: 'FAC-2026-002',
    items: [
      { description: 'Bureau ergonomique reglable 160x80cm', qty: 2, unitPriceHT: 385.00 },
      { description: 'Fauteuil de bureau ergonomique Pro', qty: 2, unitPriceHT: 290.00 },
      { description: 'Lampe de bureau LED articulee', qty: 4, unitPriceHT: 45.00 },
      { description: 'Support ecran double bras articule', qty: 2, unitPriceHT: 67.71 },
    ],
  },
  {
    montant: 890.00, date: '2026-03-04', fournisseur: 'SAS Bureau Express', reference: 'FAC-2026-003',
    items: [
      { description: 'Ramette papier A4 80g (carton 5x500)', qty: 10, unitPriceHT: 28.50 },
      { description: 'Stylos bille bleu (boite de 50)', qty: 3, unitPriceHT: 12.00 },
      { description: 'Classeurs levier A4 dos 80mm', qty: 20, unitPriceHT: 4.50 },
      { description: 'Post-it couleurs assorties (lot 12)', qty: 5, unitPriceHT: 8.50 },
      { description: 'Agrafeuse professionnelle + agrafes', qty: 5, unitPriceHT: 15.17 },
    ],
  },
  {
    montant: 4200.00, date: '2026-03-06', fournisseur: 'SARL NetServices', reference: 'FAC-2026-004',
    items: [
      { description: 'Licence cloud Pro - 25 utilisateurs (annuel)', qty: 1, unitPriceHT: 1800.00 },
      { description: 'Stockage supplementaire 500Go (annuel)', qty: 1, unitPriceHT: 600.00 },
      { description: 'Module securite avancee (annuel)', qty: 1, unitPriceHT: 500.00 },
      { description: 'Support technique prioritaire (annuel)', qty: 1, unitPriceHT: 600.00 },
    ],
  },
  {
    montant: 675.30, date: '2026-03-08', fournisseur: 'ETS Martin Fournitures', reference: 'FAC-2026-005',
    items: [
      { description: 'Toner noir HP LaserJet Pro', qty: 3, unitPriceHT: 85.00 },
      { description: 'Toner couleur HP (cyan/magenta/jaune)', qty: 3, unitPriceHT: 72.75 },
      { description: 'Tambour d\'impression HP compatible', qty: 1, unitPriceHT: 37.25 },
    ],
  },

  // ── Split factures for mouvement 6 (3000 = 1800 + 1200) ──
  {
    montant: 1800.00, date: '2026-03-10', fournisseur: 'SAS LogiTrans', reference: 'FAC-2026-006A',
    items: [
      { description: 'Transport palette zone Nord (Paris-Lille)', qty: 3, unitPriceHT: 250.00 },
      { description: 'Transport colis express (J+1)', qty: 5, unitPriceHT: 45.00 },
      { description: 'Assurance marchandise valeur declaree', qty: 1, unitPriceHT: 75.00 },
      { description: 'Emballage securise palette', qty: 3, unitPriceHT: 25.00 },
    ],
  },
  {
    montant: 1200.00, date: '2026-03-11', fournisseur: 'SAS LogiTrans', reference: 'FAC-2026-006B',
    items: [
      { description: 'Transport palette zone Sud (Paris-Lyon)', qty: 2, unitPriceHT: 280.00 },
      { description: 'Transport colis standard (J+3)', qty: 8, unitPriceHT: 30.00 },
      { description: 'Manutention chargement/dechargement', qty: 2, unitPriceHT: 70.00 },
    ],
  },

  // ── Split factures for mouvement 7 (5500 = 3000 + 2500) ──
  {
    montant: 3000.00, date: '2026-03-12', fournisseur: 'SARL CleanPro', reference: 'FAC-2026-007A',
    items: [
      { description: 'Nettoyage bureaux 500m2 - Janvier', qty: 1, unitPriceHT: 625.00 },
      { description: 'Nettoyage bureaux 500m2 - Fevrier', qty: 1, unitPriceHT: 625.00 },
      { description: 'Nettoyage vitres interieures/exterieures', qty: 2, unitPriceHT: 350.00 },
      { description: 'Desinfection sanitaires (mensuel)', qty: 2, unitPriceHT: 125.00 },
      { description: 'Fourniture produits d\'entretien', qty: 2, unitPriceHT: 150.00 },
    ],
  },
  {
    montant: 2500.00, date: '2026-03-13', fournisseur: 'SARL CleanPro', reference: 'FAC-2026-007B',
    items: [
      { description: 'Nettoyage bureaux 500m2 - Mars', qty: 1, unitPriceHT: 625.00 },
      { description: 'Shampouinage moquettes 200m2', qty: 1, unitPriceHT: 480.00 },
      { description: 'Nettoyage approfondi cuisine collective', qty: 1, unitPriceHT: 320.00 },
      { description: 'Lustrage sols carrelage hall entree', qty: 1, unitPriceHT: 283.33 },
      { description: 'Fourniture produits d\'entretien mars', qty: 1, unitPriceHT: 375.00 },
    ],
  },

  // ── Split factures for mouvement 8 (1800 = 1000 + 800) ──
  {
    montant: 1000.00, date: '2026-03-14', fournisseur: 'ETS Garage Central', reference: 'FAC-2026-008A',
    items: [
      { description: 'Revision complete vehicule Renault Kangoo', qty: 1, unitPriceHT: 320.00 },
      { description: 'Vidange huile moteur + filtre', qty: 1, unitPriceHT: 85.00 },
      { description: 'Remplacement plaquettes frein avant', qty: 1, unitPriceHT: 180.00 },
      { description: 'Equilibrage et geometrie', qty: 1, unitPriceHT: 95.00 },
      { description: 'Diagnostic electronique complet', qty: 1, unitPriceHT: 153.33 },
    ],
  },
  {
    montant: 800.00, date: '2026-03-15', fournisseur: 'ETS Garage Central', reference: 'FAC-2026-008B',
    items: [
      { description: 'Pneu Michelin Energy 195/65R15', qty: 4, unitPriceHT: 95.00 },
      { description: 'Montage et equilibrage pneus', qty: 4, unitPriceHT: 20.00 },
      { description: 'Valve pneu neuve', qty: 4, unitPriceHT: 6.67 },
    ],
  },

  // ── Partial match mouvement 9 (2500 but facture only 2000) ──
  {
    montant: 2000.00, date: '2026-03-16', fournisseur: 'SAS FormaPro', reference: 'FAC-2026-009',
    items: [
      { description: 'Formation securite informatique (2 jours)', qty: 1, unitPriceHT: 800.00 },
      { description: 'Support de cours et documentation', qty: 10, unitPriceHT: 25.00 },
      { description: 'Certification individuelle examen en ligne', qty: 10, unitPriceHT: 58.33 },
    ],
  },

  // ── Partial match mouvement 10 (7800 but factures = 5000 + 1500 = 6500) ──
  {
    montant: 5000.00, date: '2026-03-18', fournisseur: 'SARL Securitas Plus', reference: 'FAC-2026-010A',
    items: [
      { description: 'Centrale alarme Honeywell Galaxy Flex', qty: 1, unitPriceHT: 1250.00 },
      { description: 'Detecteur de mouvement infrarouge', qty: 8, unitPriceHT: 85.00 },
      { description: 'Detecteur ouverture porte/fenetre', qty: 12, unitPriceHT: 35.00 },
      { description: 'Clavier a code LCD retro-eclaire', qty: 2, unitPriceHT: 145.00 },
      { description: 'Installation et mise en service', qty: 1, unitPriceHT: 580.00 },
      { description: 'Cablage et fournitures electriques', qty: 1, unitPriceHT: 238.33 },
    ],
  },
  {
    montant: 1500.00, date: '2026-03-19', fournisseur: 'SARL Securitas Plus', reference: 'FAC-2026-010B',
    items: [
      { description: 'Abonnement telesurveillance 24/7 (6 mois)', qty: 1, unitPriceHT: 750.00 },
      { description: 'Intervention sur alarme (forfait S1)', qty: 1, unitPriceHT: 350.00 },
      { description: 'Maintenance preventive systeme (S1)', qty: 1, unitPriceHT: 150.00 },
    ],
  },

  // ── Partial match mouvement 11 (3200 but facture only 2800) ──
  {
    montant: 2800.00, date: '2026-03-20', fournisseur: 'ETS Elec Industrie', reference: 'FAC-2026-011',
    items: [
      { description: 'Tableau electrique LEGRAND 4 rangees', qty: 1, unitPriceHT: 420.00 },
      { description: 'Disjoncteur differentiel 30mA', qty: 6, unitPriceHT: 65.00 },
      { description: 'Disjoncteur modulaire 16A', qty: 12, unitPriceHT: 18.00 },
      { description: 'Cable electrique R2V 3G2.5 (100m)', qty: 2, unitPriceHT: 125.00 },
      { description: 'Main d\'oeuvre electricien qualifie (heures)', qty: 8, unitPriceHT: 55.00 },
      { description: 'Mise en conformite et certificat Consuel', qty: 1, unitPriceHT: 183.33 },
    ],
  },

  // ── Near match mouvement 18 (999.99 vs facture 1000) ──
  {
    montant: 1000.00, date: '2026-03-26', fournisseur: 'SAS AquaPure', reference: 'FAC-2026-015',
    items: [
      { description: 'Location fontaine eau froide/temperee', qty: 2, unitPriceHT: 125.00 },
      { description: 'Location fontaine eau gazeuse premium', qty: 1, unitPriceHT: 185.00 },
      { description: 'Bonbonne eau minerale 18.9L', qty: 12, unitPriceHT: 15.00 },
      { description: 'Kit filtration charbon actif', qty: 3, unitPriceHT: 28.33 },
      { description: 'Gobelets biodegradables (carton 2000)', qty: 2, unitPriceHT: 22.50 },
    ],
  },

  // ── Exact match mouvement 19 (duplicate supplier/amount) ──
  {
    montant: 1500.00, date: '2026-03-27', fournisseur: 'SARL TechnoPlus', reference: 'FAC-2026-016',
    items: [
      { description: 'Maintenance preventive serveur secondaire', qty: 1, unitPriceHT: 450.00 },
      { description: 'Mise a jour antivirus postes (25 licences)', qty: 1, unitPriceHT: 375.00 },
      { description: 'Nettoyage et optimisation base de donnees', qty: 1, unitPriceHT: 200.00 },
      { description: 'Verification certificats SSL', qty: 1, unitPriceHT: 225.00 },
    ],
  },

  // ── Split into 3 for mouvement 20 (6100 = 2500 + 2100 + 1500) ──
  {
    montant: 2500.00, date: '2026-03-28', fournisseur: 'ETS Durand & Fils', reference: 'FAC-2026-017A',
    items: [
      { description: 'Bureau direction noyer 180x90cm', qty: 1, unitPriceHT: 850.00 },
      { description: 'Fauteuil direction cuir veritable', qty: 1, unitPriceHT: 620.00 },
      { description: 'Bibliotheque murale 5 etageres', qty: 1, unitPriceHT: 380.00 },
      { description: 'Livraison et montage sur site', qty: 1, unitPriceHT: 233.33 },
    ],
  },
  {
    montant: 2100.00, date: '2026-03-28', fournisseur: 'ETS Durand & Fils', reference: 'FAC-2026-017B',
    items: [
      { description: 'Table de reunion ovale 240x120cm', qty: 1, unitPriceHT: 720.00 },
      { description: 'Chaise conference empilable', qty: 10, unitPriceHT: 65.00 },
      { description: 'Meuble bas rangement 2 portes', qty: 2, unitPriceHT: 185.00 },
      { description: 'Livraison et montage sur site', qty: 1, unitPriceHT: 160.00 },
    ],
  },
  {
    montant: 1500.00, date: '2026-03-29', fournisseur: 'ETS Durand & Fils', reference: 'FAC-2026-017C',
    items: [
      { description: 'Bureau open space double 160x160cm', qty: 2, unitPriceHT: 310.00 },
      { description: 'Caisson mobile 3 tiroirs a roulettes', qty: 4, unitPriceHT: 75.00 },
      { description: 'Separation acoustique bureau 120cm', qty: 2, unitPriceHT: 95.00 },
      { description: 'Livraison et montage sur site', qty: 1, unitPriceHT: 100.00 },
    ],
  },

  // ── ORPHAN FACTURES (no matching mouvement) ──
  {
    montant: 3750.00, date: '2026-03-05', fournisseur: 'SAS InfoPrint', reference: 'FAC-2026-X01',
    items: [
      { description: 'Location photocopieur Konica Minolta C258 (annuel)', qty: 1, unitPriceHT: 1800.00 },
      { description: 'Pack maintenance et toners inclus (annuel)', qty: 1, unitPriceHT: 650.00 },
      { description: 'Module finition agrafage/perforation', qty: 1, unitPriceHT: 425.00 },
      { description: 'Installation et formation utilisateurs', qty: 1, unitPriceHT: 250.00 },
    ],
  },
  {
    montant: 560.00, date: '2026-03-08', fournisseur: 'SARL Cafe Premium', reference: 'FAC-2026-X02',
    items: [
      { description: 'Location machine Jura X8 (mensuel)', qty: 1, unitPriceHT: 180.00 },
      { description: 'Capsules espresso intenso (carton 200)', qty: 2, unitPriceHT: 78.00 },
      { description: 'Capsules lungo doux (carton 200)', qty: 1, unitPriceHT: 72.00 },
      { description: 'Lait en poudre barista (5kg)', qty: 2, unitPriceHT: 29.33 },
      { description: 'Gobelets carton double paroi 200ml (500)', qty: 1, unitPriceHT: 0.01 },
    ],
  },
  {
    montant: 12500.00, date: '2026-03-15', fournisseur: 'SAS ArchiDesign', reference: 'FAC-2026-X03',
    items: [
      { description: 'Conception plans amenagement accueil', qty: 1, unitPriceHT: 2500.00 },
      { description: 'Banque d\'accueil design sur mesure', qty: 1, unitPriceHT: 3200.00 },
      { description: 'Fauteuils attente design (lot de 6)', qty: 1, unitPriceHT: 1800.00 },
      { description: 'Revetement sol vinyle premium 80m2', qty: 80, unitPriceHT: 22.50 },
      { description: 'Peinture et finitions murales', qty: 1, unitPriceHT: 950.00 },
      { description: 'Eclairage LED encastre (12 spots)', qty: 12, unitPriceHT: 45.83 },
    ],
  },
  {
    montant: 890.00, date: '2026-03-20', fournisseur: 'ETS Plomberie Martin', reference: 'FAC-2026-X04',
    items: [
      { description: 'Deplacement et diagnostic fuite', qty: 1, unitPriceHT: 80.00 },
      { description: 'Remplacement robinet mitigeur', qty: 2, unitPriceHT: 95.00 },
      { description: 'Reparation chasse d\'eau WC', qty: 1, unitPriceHT: 120.00 },
      { description: 'Joint et raccord cuivre (fournitures)', qty: 1, unitPriceHT: 45.00 },
      { description: 'Main d\'oeuvre plombier (heures)', qty: 3, unitPriceHT: 65.56 },
    ],
  },
  {
    montant: 2200.00, date: '2026-03-25', fournisseur: 'SARL WebAgency', reference: 'FAC-2026-X05',
    items: [
      { description: 'Audit UX/UI site existant', qty: 1, unitPriceHT: 450.00 },
      { description: 'Maquettes wireframes (8 pages)', qty: 8, unitPriceHT: 75.00 },
      { description: 'Design graphique charte v2', qty: 1, unitPriceHT: 550.00 },
      { description: 'Integration HTML/CSS responsive', qty: 1, unitPriceHT: 383.33 },
    ],
  },
  {
    montant: 175.50, date: '2026-03-28', fournisseur: 'SAS PostExpress', reference: 'FAC-2026-X06',
    items: [
      { description: 'Affranchissement lettre prioritaire (lot)', qty: 45, unitPriceHT: 1.80 },
      { description: 'Envoi recommande avec AR', qty: 5, unitPriceHT: 6.50 },
      { description: 'Colis Colissimo 1kg (France metro)', qty: 3, unitPriceHT: 8.75 },
    ],
  },
];

// ─── PDF GENERATION ───
function generateFacturePDF(facture: FactureDef, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const siret = `${Math.floor(Math.random() * 900000000 + 100000000)} 00012`;
    const tvaIntra = `FR${Math.floor(Math.random() * 90 + 10)} ${Math.floor(Math.random() * 900000000 + 100000000)}`;

    // ── Header: Fournisseur info ──
    doc.fontSize(11).font('Helvetica-Bold').text(facture.fournisseur, 50, 50);
    doc.fontSize(9).font('Helvetica');
    doc.text('123 Rue du Commerce', 50, 65);
    doc.text('75001 Paris, France', 50, 77);
    doc.text(`SIRET: ${siret}`, 50, 89);
    doc.text(`TVA Intra: ${tvaIntra}`, 50, 101);

    // ── Title ──
    doc.moveDown(2);
    doc.fontSize(24).font('Helvetica-Bold').text('FACTURE', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica').text(`N\u00b0 ${facture.reference}`, { align: 'center' });

    // ── Dates ──
    doc.moveDown(1.5);
    doc.fontSize(10);
    const echeanceDate = new Date(facture.date);
    echeanceDate.setDate(echeanceDate.getDate() + 30);
    const echeanceStr = echeanceDate.toISOString().split('T')[0];
    doc.text(`Date d'emission : ${facture.date}`, 50);
    doc.text(`Date d'echeance : ${echeanceStr}`, 50);

    // ── Client ──
    doc.moveDown(1);
    doc.font('Helvetica-Bold').text('Facture a :', 350, doc.y - 30);
    doc.font('Helvetica');
    doc.text('Entreprise Client SARL', 350);
    doc.text('456 Avenue des Affaires', 350);
    doc.text('69001 Lyon, France', 350);
    doc.text('SIRET: 987 654 321 00045', 350);

    // ── Table Header ──
    const colDesc = 50;
    const colQty = 310;
    const colUnit = 365;
    const colHT = 430;
    const colTTC = 495;

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

    // ── Compute adjusted items so TTC totals match facture.montant ──
    const targetTTC = facture.montant;
    const targetHT = +(targetTTC / 1.2).toFixed(2);

    // Calculate raw sum of all items HT
    let rawSumHT = 0;
    for (const item of facture.items) {
      rawSumHT += +(item.qty * item.unitPriceHT).toFixed(2);
    }

    // Build adjusted items: adjust last item's unit price to hit targetHT exactly
    const adjustedItems = facture.items.map((item, i) => {
      if (i < facture.items.length - 1) {
        const lineHT = +(item.qty * item.unitPriceHT).toFixed(2);
        return { ...item, lineHT, unitPrice: item.unitPriceHT };
      }
      // Last item absorbs the rounding difference
      let otherHT = 0;
      for (let j = 0; j < facture.items.length - 1; j++) {
        otherHT += +(facture.items[j].qty * facture.items[j].unitPriceHT).toFixed(2);
      }
      const lastLineHT = +(targetHT - otherHT).toFixed(2);
      const adjustedUnit = +(lastLineHT / item.qty).toFixed(2);
      return { ...item, lineHT: lastLineHT, unitPrice: adjustedUnit };
    });

    // ── Line Items ──
    doc.font('Helvetica').fontSize(9);
    let totalHT = 0;

    for (const item of adjustedItems) {
      const lineHT = item.lineHT;
      const lineTTC = +(lineHT * 1.2).toFixed(2);
      totalHT += lineHT;

      doc.text(item.description, colDesc, y, { width: 250 });
      doc.text(String(item.qty), colQty, y, { width: 40, align: 'center' });
      doc.text(`${item.unitPrice.toFixed(2)}`, colUnit, y, { width: 55, align: 'right' });
      doc.text(`${lineHT.toFixed(2)}`, colHT, y, { width: 55, align: 'right' });
      doc.text(`${lineTTC.toFixed(2)}`, colTTC, y, { width: 55, align: 'right' });

      y += 18;
    }

    // ── Separator ──
    y += 5;
    doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke();
    y += 15;

    // ── Totals ──
    totalHT = +targetHT;
    const tva = +(targetTTC - targetHT).toFixed(2);
    const totalTTC = targetTTC;

    doc.font('Helvetica').fontSize(10);
    doc.text('Total HT :', 380, y, { width: 70, align: 'right' });
    doc.text(`${totalHT.toFixed(2)} EUR`, colTTC - 10, y, { width: 70, align: 'right' });
    y += 18;

    doc.text('TVA (20%) :', 380, y, { width: 70, align: 'right' });
    doc.text(`${tva.toFixed(2)} EUR`, colTTC - 10, y, { width: 70, align: 'right' });
    y += 18;

    doc.moveTo(380, y).lineTo(555, y).lineWidth(1).stroke();
    y += 8;

    doc.font('Helvetica-Bold').fontSize(13);
    doc.text('TOTAL TTC :', 370, y, { width: 80, align: 'right' });
    doc.text(`${totalTTC.toFixed(2)} EUR`, colTTC - 20, y, { width: 80, align: 'right' });

    // ── Payment info ──
    y += 40;
    doc.font('Helvetica').fontSize(9);
    doc.text('Conditions de paiement : 30 jours fin de mois', 50, y);
    doc.text('Mode de reglement : Virement bancaire', 50, y + 12);
    doc.text('IBAN : FR76 3000 6000 0112 3456 7890 189', 50, y + 24);
    doc.text('BIC : AGRIFRPP', 50, y + 36);

    // ── Footer ──
    doc.font('Helvetica').fontSize(7);
    doc.text(
      `${facture.fournisseur} - RCS Paris - SIRET: ${siret} - TVA: ${tvaIntra}`,
      50, 755, { align: 'center', width: 495 }
    );
    doc.text(
      'En cas de retard de paiement, penalite de 3x le taux d\'interet legal + indemnite forfaitaire de 40 EUR.',
      50, 767, { align: 'center', width: 495 }
    );

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ─── MAIN SEED ───
export async function seed() {
  const ALL_TYPES = ['mouvement', 'rapprochement', 'document'];

  console.log('--- Clearing existing data ---');
  for (const t of ALL_TYPES) {
    const ids = await redis.smembers(`${t}:ids`);
    if (ids.length) {
      const p = redis.pipeline();
      for (const id of ids) { p.del(`${t}:${id}`); p.del(`${t}:${id}:pdf`); }
      p.del(`${t}:ids`);
      await p.exec();
      console.log(`  Cleared ${ids.length} ${t}s`);
    }
  }

  // ── Insert mouvements ──
  console.log('\n--- Seeding mouvements ---');
  const mPipe = redis.pipeline();
  for (const m of mouvements) {
    const id = uuidv4();
    mPipe.set(`mouvement:${id}`, JSON.stringify({
      id, montant: m.montant, date: m.date, libelle: m.libelle,
      type_mouvement: m.type_mouvement, reference: m.reference,
      type: 'mouvement', createdAt: new Date().toISOString(),
    }));
    mPipe.sadd('mouvement:ids', id);
  }
  await mPipe.exec();
  console.log(`  Inserted ${mouvements.length} mouvements`);

  // ── Generate & store seed factures (the original 26) ──
  console.log('\n--- Generating seed facture PDFs ---');
  const pdfDir = path.join(__dirname, '..', 'seed-factures');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  for (const file of fs.readdirSync(pdfDir)) {
    if (file.endsWith('.pdf')) fs.unlinkSync(path.join(pdfDir, file));
  }

  const fPipe = redis.pipeline();
  for (const f of factures) {
    const fileName = `${f.reference}.pdf`;
    const filePath = path.join(pdfDir, fileName);
    await generateFacturePDF(f, filePath);
    const pdfBuffer = fs.readFileSync(filePath);
    const id = uuidv4();
    fPipe.set(`document:${id}`, JSON.stringify({
      id, fileName, rawText: '', montant: f.montant, date: f.date,
      fournisseur: f.fournisseur, reference: f.reference,
      docType: 'facture', type: 'facture', createdAt: new Date().toISOString(),
    }));
    fPipe.set(`document:${id}:pdf`, pdfBuffer.toString('base64'));
    fPipe.sadd('document:ids', id);
    console.log(`  ${fileName} | ${f.montant.toFixed(2)} EUR | ${f.fournisseur}`);
  }
  await fPipe.exec();

  // ── Generate & store full document chain (devis, BC, BL, BR, factures, emails) ──
  console.log('\n--- Generating document chain PDFs ---');
  const { generateAllDocuments } = await import('./seed-documents');
  const { scenarios, emails } = await generateAllDocuments();

  const docDir = path.join(__dirname, '..', 'seed-documents');
  const dPipe = redis.pipeline();

  // Store scenario documents
  for (const s of scenarios) {
    const totals = s.items.reduce((sum: number, i: any) => sum + +(i.qty * i.unitHT).toFixed(2), 0);
    const ttc = +(totals * 1.2).toFixed(2);

    const docDefs = [
      { type: 'devis', ref: `DDV-${s.id}`, subdir: 'devis', date: s.dates.devis, montant: ttc },
      { type: 'bon_commande', ref: `BC-${s.id}`, subdir: 'bons-commande', date: s.dates.bc, montant: ttc },
      { type: 'bon_livraison', ref: `BL-${s.id}`, subdir: 'bons-livraison', date: s.dates.bl, montant: null },
      { type: 'bon_reception', ref: `BR-${s.id}`, subdir: 'bons-reception', date: s.dates.br, montant: null },
      { type: 'facture', ref: `FAC-${s.id}`, subdir: 'factures', date: s.dates.facture, montant: ttc },
    ];

    for (const d of docDefs) {
      const filePath = path.join(docDir, d.subdir, `${d.ref}.pdf`);
      if (!fs.existsSync(filePath)) continue;
      const pdfBuf = fs.readFileSync(filePath);
      const id = uuidv4();
      const record: any = {
        id, fileName: `${d.ref}.pdf`, rawText: '', date: d.date,
        fournisseur: s.fournisseur, reference: d.ref, scenarioId: s.id,
        docType: d.type, type: d.type, createdAt: new Date().toISOString(),
      };
      if (d.montant) record.montant = d.montant;
      if (d.type === 'bon_commande') record.devisRef = `DDV-${s.id}`;
      if (d.type === 'bon_livraison') record.commandeRef = `BC-${s.id}`;
      if (d.type === 'bon_reception') { record.commandeRef = `BC-${s.id}`; record.livraisonRef = `BL-${s.id}`; }

      // All documents go to the same collection
      dPipe.set(`document:${id}`, JSON.stringify(record));
      dPipe.set(`document:${id}:pdf`, pdfBuf.toString('base64'));
      dPipe.sadd('document:ids', id);
    }

    // Add matching mouvement for the scenario
    const mId = uuidv4();
    dPipe.set(`mouvement:${mId}`, JSON.stringify({
      id: mId, montant: ttc, date: s.dates.paiement,
      libelle: `VIR ${s.fournisseur} - ${docDefs[0].ref}`,
      type_mouvement: 'sortie', reference: `PAY-${s.id}`,
      scenarioId: s.id, type: 'mouvement', createdAt: new Date().toISOString(),
    }));
    dPipe.sadd('mouvement:ids', mId);
  }

  // Store emails as documents
  for (const e of emails) {
    const filePath = path.join(docDir, 'emails', `EMAIL-${e.id}.pdf`);
    const id = uuidv4();
    const record = {
      id, from: e.from, to: e.to, subject: e.subject, date: e.date,
      body: e.body, hasRelation: e.hasRelation, relationType: e.relationType,
      scenarioId: e.scenarioId, docType: 'email', type: 'email',
      createdAt: new Date().toISOString(),
    };
    dPipe.set(`document:${id}`, JSON.stringify(record));
    if (fs.existsSync(filePath)) {
      dPipe.set(`document:${id}:pdf`, fs.readFileSync(filePath).toString('base64'));
    }
    dPipe.sadd('document:ids', id);
  }

  await dPipe.exec();
  console.log(`\n[Seed] Stored ${scenarios.length} full document chains + ${emails.length} emails`);
  console.log('[Seed] Complete!');
}

// Allow running standalone: npx ts-node src/seed.ts
if (require.main === module) {
  seed().then(() => process.exit(0)).catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  });
}
