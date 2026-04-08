import pdfParse from 'pdf-parse';

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const data = await (pdfParse as any)(buffer);
  return data.text;
}
