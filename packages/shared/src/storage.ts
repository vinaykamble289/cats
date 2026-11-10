import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { optional, required } from './env.js';
import { AppError } from './errors.js';

let client: SupabaseClient | undefined;
let bucketReady: Promise<void> | undefined;

function supabase(): SupabaseClient {
  client ??= createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const bucketName = () => optional('STORAGE_BUCKET', 'hireflow-files');

/** Creates the private bucket on first use. */
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const { data } = await supabase().storage.getBucket(bucketName());
    if (!data) {
      const { error } = await supabase().storage.createBucket(bucketName(), { public: false, fileSizeLimit: 20 * 1024 * 1024 });
      if (error && !/already exists/i.test(error.message)) throw error;
    }
  })().catch((err) => {
    bucketReady = undefined;
    throw err;
  });
  return bucketReady;
}

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
];

function safeName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'file';
}

/** Uploads a file and returns its storage path. `folder` like 'resumes/<candidateId>'. */
export async function uploadFile(folder: string, fileName: string, body: Buffer, contentType: string): Promise<string> {
  await ensureBucket();
  const path = `${folder}/${randomUUID()}-${safeName(fileName)}`;
  const { error } = await supabase().storage.from(bucketName()).upload(path, body, { contentType, upsert: false });
  if (error) throw new AppError(502, `File upload failed: ${error.message}`, 'STORAGE_ERROR');
  return path;
}

/** Short-lived signed URL for viewing/downloading a private file. */
export async function signedUrl(path: string, expiresInSeconds = 600, downloadName?: string): Promise<string> {
  const { data, error } = await supabase()
    .storage.from(bucketName())
    .createSignedUrl(path, expiresInSeconds, downloadName ? { download: downloadName } : undefined);
  if (error || !data) throw new AppError(502, `Could not create file link: ${error?.message}`, 'STORAGE_ERROR');
  return data.signedUrl;
}

export async function removeFile(path: string): Promise<void> {
  await supabase().storage.from(bucketName()).remove([path]);
}

/** Supabase admin API (identity-service uses it to invite users). */
export function supabaseAdmin(): SupabaseClient {
  return supabase();
}
