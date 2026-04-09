import { PDFParse } from 'pdf-parse';
import Tesseract from 'tesseract.js';

const MIN_TEXT_LENGTH = 50;

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  // 1. Try text-based extraction first
  const arr = new Uint8Array(buffer);
  const parser = new PDFParse(arr);
  const result = await parser.getText();
  const text = result.pages.map((p: any) => p.text).join('\n').trim();

  if (text.length >= MIN_TEXT_LENGTH) {
    console.log(`[PDF] Text extraction OK (${text.length} chars)`);
    return text;
  }

  // 2. Fallback: OCR with Tesseract (for scanned/image PDFs)
  console.log(`[PDF] Text too short (${text.length} chars), falling back to OCR...`);

  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(buffer, { scale: 2 });

  const pages: string[] = [];
  let pageNum = 0;

  for await (const pageImage of doc) {
    pageNum++;
    const { data: { text: ocrText } } = await Tesseract.recognize(pageImage, 'fra+eng');
    console.log(`[PDF] OCR page ${pageNum}: ${ocrText.length} chars`);
    pages.push(ocrText);
  }

  const fullText = pages.join('\n\n--- Page ---\n\n');
  console.log(`[PDF] OCR complete: ${fullText.length} total chars from ${pageNum} pages`);
  return fullText;
}
