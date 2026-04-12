import { parse } from 'csv-parse/sync';

export type ParsedMouvementRow = {
  montant: number;
  date: string;
  libelle: string;
  type_mouvement: 'sortie' | 'entree';
  reference: string;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, '');
}

function normalizeKey(k: string): string {
  return stripBom(k)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function guessDelimiter(text: string): ',' | ';' | '\t' {
  const line = text.split(/\r?\n/)[0] ?? '';
  const semi = (line.match(/;/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  if (tabs > semi && tabs > comma) return '\t';
  return semi >= comma ? ';' : ',';
}

function parseFrenchNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let d = parseInt(m[1], 10);
    let mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    if (d > 31) {
      const tmp = d;
      d = mo;
      mo = tmp;
    }
    const mm = String(mo).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

const DATE_KEYS = new Set(['date', 'dt', 'date_operation', 'dateop', 'bookingdate', 'valuedate', 'date_comptable']);
const MONTANT_KEYS = new Set(['montant', 'amount', 'amt', 'valeur', 'credit', 'debit', 'solde', 'montant_eur']);
const LIBELLE_KEYS = new Set(['libelle', 'label', 'description', 'detail', 'wording', 'intitule', 'nom', 'lib']);
const REF_KEYS = new Set(['reference', 'ref', 'transaction_id', 'id_operation']);
const TYPE_KEYS = new Set(['type', 'sens', 'direction', 'type_mouvement']);

function rowToNormalizedMap(row: Record<string, string>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    m[normalizeKey(k)] = v != null ? String(v) : '';
  }
  return m;
}

function firstValue(norm: Record<string, string>, keys: Set<string>): string {
  for (const k of Object.keys(norm)) {
    if (keys.has(k) && norm[k]?.trim()) return norm[k].trim();
  }
  return '';
}

/**
 * Parse un CSV relevé / export : en-têtes FR/EN (date, montant, libellé…).
 */
export function parseMouvementsCsv(buffer: Buffer): { rows: ParsedMouvementRow[]; errors: string[]; headers: string[] } {
  const text = stripBom(buffer.toString('utf8'));
  const delimiter = guessDelimiter(text);
  const errors: string[] = [];

  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      delimiter,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (e) {
    return { rows: [], errors: [e instanceof Error ? e.message : String(e)], headers: [] };
  }

  if (!records.length) {
    return { rows: [], errors: ['Aucune ligne de données'], headers: [] };
  }

  const headers = Object.keys(records[0]);
  const rows: ParsedMouvementRow[] = [];
  let lineNo = 2;

  for (const record of records) {
    const norm = rowToNormalizedMap(record);

    let dateStr = firstValue(norm, DATE_KEYS);
    if (!dateStr) {
      const vals = Object.values(record);
      dateStr = vals[0]?.trim() || '';
    }

    let montantStr = firstValue(norm, MONTANT_KEYS);
    if (!montantStr) {
      for (const v of Object.values(record)) {
        const n = parseFrenchNumber(String(v));
        if (n != null && Math.abs(n) > 0.0001) {
          montantStr = String(v);
          break;
        }
      }
    }

    let libelle = firstValue(norm, LIBELLE_KEYS);
    if (!libelle) {
      const vals = Object.values(record).filter((x) => x && String(x).length > 2);
      libelle = vals[vals.length - 1] || vals[1] || '—';
    }

    const reference = firstValue(norm, REF_KEYS);
    const typeRaw = firstValue(norm, TYPE_KEYS).toLowerCase();

    const date = parseDate(dateStr);
    const montantSigned = montantStr ? parseFrenchNumber(montantStr) : null;

    if (!date || montantSigned == null) {
      errors.push(`Ligne ${lineNo}: date ou montant illisible`);
      lineNo++;
      continue;
    }

    const abs = Math.abs(montantSigned);
    let type_mouvement: 'sortie' | 'entree' = montantSigned < 0 ? 'sortie' : 'entree';
    if (typeRaw.includes('entree') || typeRaw.includes('credit') || typeRaw === 'in' || typeRaw === 'crédit')
      type_mouvement = 'entree';
    if (typeRaw.includes('sortie') || typeRaw.includes('debit') || typeRaw === 'out' || typeRaw === 'débit')
      type_mouvement = 'sortie';

    rows.push({
      montant: abs,
      date,
      libelle: libelle.slice(0, 500),
      type_mouvement,
      reference: reference.slice(0, 200),
    });
    lineNo++;
  }

  return { rows, errors, headers };
}
