import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import { PDFParse } from 'pdf-parse';
import Tesseract from 'tesseract.js';

const MIN_TEXT_LENGTH = 50;

const nodeRequire = createRequire(__filename);

/** pdf.js (via pdf-parse) doit résoudre polices / cmaps / wasm sur le disque en Node — sinon warnings + erreurs `standardFontDataUrl`. */
function pdfJsAssetBaseUrl(subdir: string): string {
  const pkgRoot = path.dirname(nodeRequire.resolve('pdfjs-dist/package.json'));
  return pathToFileURL(path.join(pkgRoot, subdir) + path.sep).href;
}

const PDF_NODE_INIT = {
  standardFontDataUrl: pdfJsAssetBaseUrl('standard_fonts'),
  cMapUrl: pdfJsAssetBaseUrl('cmaps'),
  wasmUrl: pdfJsAssetBaseUrl('wasm'),
} as const;

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const arr = new Uint8Array(buffer);
  const parser = new PDFParse({
    data: arr,
    ...PDF_NODE_INIT,
  });
  const result = await parser.getText();
  const text = result.pages.map((p: { text: string }) => p.text).join('\n').trim();

  if (text.length >= MIN_TEXT_LENGTH) {
    console.log(`[PDF] Text extraction OK (${text.length} chars)`);
    return text;
  }

  console.log(`[PDF] Text too short (${text.length} chars), falling back to OCR...`);

  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(buffer, { scale: 2 });

  const pages: string[] = [];
  let pageNum = 0;

  for await (const pageImage of doc) {
    pageNum++;
    const {
      data: { text: ocrText },
    } = await Tesseract.recognize(pageImage, 'fra+eng');
    console.log(`[PDF] OCR page ${pageNum}: ${ocrText.length} chars`);
    pages.push(ocrText);
  }

  const fullText = pages.join('\n\n--- Page ---\n\n');
  console.log(`[PDF] OCR complete: ${fullText.length} total chars from ${pageNum} pages`);
  return fullText;
}
