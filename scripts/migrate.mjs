// Applies db/migrations/*.sql in order, exactly once each.
// Usage: npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'db', 'migrations');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql`create schema if not exists platform`;
  await sql`create table if not exists platform.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const applied = new Set((await sql`select name from platform.schema_migrations`).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into platform.schema_migrations (name) values (${file})`;
    });
    console.log('done');
    count++;
  }
  console.log(count ? `Applied ${count} migration(s).` : 'Database is up to date.');
} catch (err) {
  console.error('\nMigration failed:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
