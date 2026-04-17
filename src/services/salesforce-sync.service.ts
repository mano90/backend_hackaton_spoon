import { v4 as uuidv4 } from 'uuid';
import redis from './redis.service';
import * as sf from './salesforce.service';
import { emitSalesforceSyncProgress } from './realtime-import.service';

export interface SyncOptions {
  dateFrom?: string;       // YYYY-MM-DD
  dateTo?: string;         // YYYY-MM-DD
  includeEmails?: boolean; // include Commercial_Document__c where type = email
}

export interface SyncResult {
  mouvements: number;
  documents: number;
  purchaseOrders: number;
  supplierInvoices: number;
  reconciliations: number;
  pdfs: number;
  errors: string[];
}

// ── Field mapping: Salesforce → Redis local model ───────────

function mapMouvement(r: Record<string, any>) {
  return {
    id: r.Id || uuidv4(),
    montant: r.Amount__c ?? 0,
    date: r.Transaction_Date__c ?? '',
    libelle: r.Transaction_Label__c ?? '',
    type_mouvement: r.Movement_Type__c ?? 'sortie',
    reference: r.Reference__c ?? '',
    scenarioId: r.Scenario_Id__c ?? null,
    sfAccountId: r.Account__c ?? null,
    type: 'mouvement' as const,
    createdAt: r.CreatedDate ?? new Date().toISOString(),
  };
}

function mapDocument(r: Record<string, any>) {
  return {
    id: r.Id || uuidv4(),
    fileName: r.Source_File_Name__c ?? '',
    rawText: r.Raw_Text__c ?? '',
    montant: r.Amount__c ?? null,
    date: r.Document_Date__c ?? '',
    fournisseur: r.Supplier__c ?? '',
    reference: r.Reference__c ?? '',
    documentType: r.Document_Type__c ?? 'autre',
    scenarioId: r.Scenario_Id__c ?? null,
    sfAccountId: r.Related_Account__c ?? null,
    sfContactId: r.Related_Contact__c ?? null,
    emailFrom: r.Email_From__c ?? null,
    emailTo: r.Email_To__c ?? null,
    emailSubject: r.Email_Subject__c ?? null,
    emailBody: r.Email_Body__c ?? null,
    type: mapDocType(r.Document_Type__c),
    createdAt: r.CreatedDate ?? new Date().toISOString(),
  };
}

function mapDocType(sfType: string): string {
  const m: Record<string, string> = {
    devis: 'devis',
    bon_commande: 'bon_commande',
    bon_livraison: 'bon_livraison',
    bon_reception: 'bon_reception',
    facture: 'facture',
    email: 'email',
    autre: 'autre',
  };
  return m[sfType] ?? 'autre';
}

function mapPurchaseOrder(r: Record<string, any>) {
  return {
    id: r.Id || uuidv4(),
    reference: r.Reference__c ?? '',
    date: r.PO_Date__c ?? '',
    montant: r.Amount__c ?? null,
    description: r.Description__c ?? '',
    status: r.Status__c ?? '',
    scenarioId: r.Scenario_Id__c ?? null,
    sfAccountId: r.Account__c ?? null,
    sfSourceDocId: r.Source_Document__c ?? null,
    type: 'purchase_order' as const,
    createdAt: r.CreatedDate ?? new Date().toISOString(),
  };
}

function mapSupplierInvoice(r: Record<string, any>) {
  return {
    id: r.Id || uuidv4(),
    reference: r.Reference__c ?? '',
    date: r.Invoice_Date__c ?? '',
    montant: r.Amount__c ?? null,
    description: r.Description__c ?? '',
    scenarioId: r.Scenario_Id__c ?? null,
    sfAccountId: r.Account__c ?? null,
    sfPurchaseOrderId: r.Related_Purchase_Order__c ?? null,
    sfSourceDocId: r.Source_Document__c ?? null,
    type: 'supplier_invoice' as const,
    createdAt: r.CreatedDate ?? new Date().toISOString(),
  };
}

function mapReconciliation(r: Record<string, any>) {
  return {
    id: r.Id || uuidv4(),
    mouvementId: r.Bank_Movement__c ?? '',
    factureIds: r.Related_Invoice__c ? [r.Related_Invoice__c] : [],
    montantMouvement: r.Transaction_Amount__c ?? 0,
    montantFactures: r.Document_Amount__c ?? 0,
    ecart: r.Difference__c ?? 0,
    status: r.Status__c ?? 'no_match',
    aiExplanation: r.AI_Explanation__c ?? '',
    confirmed: r.Confirmed__c ?? false,
    scenarioId: r.Scenario_Id__c ?? null,
    sfAccountId: r.Account__c ?? null,
    type: 'rapprochement' as const,
    createdAt: r.CreatedDate ?? new Date().toISOString(),
  };
}

// ── Main sync function ──────────────────────────────────────

export async function syncFromSalesforce(options: SyncOptions = {}): Promise<SyncResult> {
  const result: SyncResult = {
    mouvements: 0, documents: 0, purchaseOrders: 0,
    supplierInvoices: 0, reconciliations: 0, pdfs: 0, errors: [],
  };

  const totalSteps = options.includeEmails ? 6 : 5;
  let currentStep = 0;

  const progress = (phase: any, objectName: string, message: string, current?: number, total?: number) => {
    currentStep++;
    emitSalesforceSyncProgress({
      phase, objectName, message,
      percent: Math.round((currentStep / (totalSteps + 1)) * 100),
      current, total,
    });
  };

  emitSalesforceSyncProgress({
    phase: 'started', message: 'Démarrage de la synchronisation Salesforce…', percent: 0,
  });

  try {
    // ── 1. Bank Movements ──
    progress('fetching', 'Bank_Movement__c', 'Récupération des mouvements bancaires…');
    const mvtRecords = await sf.queryAllRecords('Bank_Movement__c', {
      dateField: 'Transaction_Date__c',
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
    for (const r of mvtRecords) {
      const m = mapMouvement(r);
      await redis.set(`mouvement:${m.id}`, JSON.stringify(m));
      await redis.sadd('mouvement:ids', m.id);
    }
    result.mouvements = mvtRecords.length;

    // ── 2. Commercial Documents (excluding emails unless opted in) ──
    progress('fetching', 'Commercial_Document__c', 'Récupération des documents commerciaux…');
    let docSoql = `SELECT Id, Name, Document_Type__c, Reference__c, Document_Date__c, Amount__c, Supplier__c, Raw_Text__c, Source_File_Name__c, Scenario_Id__c, Related_Account__c, Related_Contact__c, Email_From__c, Email_To__c, Email_Subject__c, Email_Body__c, CreatedDate FROM Commercial_Document__c`;
    const docConditions: string[] = [];
    if (!options.includeEmails) {
      docConditions.push(`Document_Type__c != 'email'`);
    }
    if (options.dateFrom) docConditions.push(`Document_Date__c >= ${options.dateFrom}`);
    if (options.dateTo) docConditions.push(`Document_Date__c <= ${options.dateTo}`);
    if (docConditions.length) docSoql += ` WHERE ${docConditions.join(' AND ')}`;
    docSoql += ` ORDER BY CreatedDate DESC`;
    const docRecords = await sf.query<Record<string, any>>(docSoql);
    for (const r of docRecords) {
      const d = mapDocument(r);
      await redis.set(`document:${d.id}`, JSON.stringify(d));
      await redis.sadd('document:ids', d.id);
    }
    result.documents = docRecords.length;

    // ── 3. Purchase Orders ──
    progress('fetching', 'Purchase_Order__c', 'Récupération des bons de commande…');
    const poRecords = await sf.queryAllRecords('Purchase_Order__c', {
      dateField: 'PO_Date__c',
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
    for (const r of poRecords) {
      const po = mapPurchaseOrder(r);
      await redis.set(`purchase_order:${po.id}`, JSON.stringify(po));
      await redis.sadd('purchase_order:ids', po.id);
    }
    result.purchaseOrders = poRecords.length;

    // ── 4. Supplier Invoices ──
    progress('fetching', 'Supplier_Invoice__c', 'Récupération des factures fournisseurs…');
    const invRecords = await sf.queryAllRecords('Supplier_Invoice__c', {
      dateField: 'Invoice_Date__c',
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });
    for (const r of invRecords) {
      const inv = mapSupplierInvoice(r);
      await redis.set(`supplier_invoice:${inv.id}`, JSON.stringify(inv));
      await redis.sadd('supplier_invoice:ids', inv.id);
    }
    result.supplierInvoices = invRecords.length;

    // ── 5. Reconciliations ──
    progress('fetching', 'Reconciliation__c', 'Récupération des rapprochements…');
    const recRecords = await sf.queryAllRecords('Reconciliation__c');
    for (const r of recRecords) {
      const rec = mapReconciliation(r);
      await redis.set(`rapprochement:${rec.id}`, JSON.stringify(rec));
      await redis.sadd('rapprochement:ids', rec.id);
    }
    result.reconciliations = recRecords.length;

    // ── 6. Download attached PDFs ──
    progress('downloading_pdf', '', 'Téléchargement des fichiers PDF attachés…');
    const allDocIds = docRecords.map((r: any) => r.Id).filter(Boolean);
    let pdfCount = 0;
    for (let i = 0; i < allDocIds.length; i++) {
      try {
        const files = await sf.getLinkedFiles(allDocIds[i]);
        for (const file of files) {
          if (file.fileExtension?.toLowerCase() === 'pdf') {
            const buf = await sf.downloadFileBody(file.contentVersionId);
            const base64 = buf.toString('base64');
            await redis.set(`document:${allDocIds[i]}:pdf`, base64);
            pdfCount++;
          }
        }
      } catch (err: any) {
        result.errors.push(`PDF ${allDocIds[i]}: ${err.message}`);
      }
      if (i % 5 === 0) {
        emitSalesforceSyncProgress({
          phase: 'downloading_pdf',
          message: `Téléchargement PDF ${i + 1}/${allDocIds.length}…`,
          percent: Math.round(80 + (i / allDocIds.length) * 18),
          current: i + 1,
          total: allDocIds.length,
        });
      }
    }
    result.pdfs = pdfCount;

    emitSalesforceSyncProgress({
      phase: 'done',
      message: `Synchronisation terminée : ${result.mouvements} mouvements, ${result.documents} documents, ${result.purchaseOrders} commandes, ${result.supplierInvoices} factures, ${result.reconciliations} rapprochements, ${result.pdfs} PDFs.`,
      percent: 100,
    });

  } catch (err: any) {
    result.errors.push(err.message);
    emitSalesforceSyncProgress({
      phase: 'error',
      message: `Erreur : ${err.message}`,
      percent: 0,
    });
  }

  return result;
}
