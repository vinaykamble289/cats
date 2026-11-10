import type { FastifyRequest } from 'fastify';
import { badRequest } from '@hireflow/shared';

export interface UploadedFile {
  fieldname: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

/** Reads a multipart request fully: text fields + file buffers. */
export async function readMultipart(req: FastifyRequest): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  if (!req.isMultipart()) throw badRequest('Expected multipart/form-data');
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (!buffer.length) continue;
      files.push({ fieldname: part.fieldname, fileName: part.filename || 'resume', mimeType: part.mimetype, buffer });
    } else {
      fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value ?? '');
    }
  }
  return { fields, files };
}
