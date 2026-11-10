import { extractText as extractPdf, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { badRequest } from '@hireflow/shared';

export type ResumeKind = 'pdf' | 'docx' | 'txt';

export const RESUME_MIME: Record<ResumeKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** Detects a supported resume type from file name / mime type. */
export function detectKind(fileName: string, mimeType?: string): ResumeKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf' || mimeType === RESUME_MIME.pdf) return 'pdf';
  if (ext === 'docx' || mimeType === RESUME_MIME.docx) return 'docx';
  if (ext === 'txt' || mimeType === 'text/plain') return 'txt';
  return null;
}

export function requireKind(fileName: string, mimeType?: string): ResumeKind {
  const kind = detectKind(fileName, mimeType);
  if (!kind) throw badRequest(`Unsupported file type for "${fileName}". Please upload a PDF, DOCX or TXT resume.`);
  return kind;
}

const MAX_CHARS = 50_000;

/** Extracts plain text from a resume file. Returns '' when the file has no extractable text (e.g. scanned PDF). */
export async function extractResumeText(buffer: Buffer, kind: ResumeKind): Promise<string> {
  let text = '';
  if (kind === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractPdf(pdf, { mergePages: true });
    text = result.text;
  } else if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    text = buffer.toString('utf8');
  }
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}
