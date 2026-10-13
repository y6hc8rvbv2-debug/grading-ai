// 隔離されたメモリ内PostgreSQL。外部DBへの接続や本番データの変更は行わない。
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(fs.readFileSync('supabase/tests/00_supabase_shim.sql','utf8'));
  await db.exec('set role app_owner');
  for (const file of fs.readdirSync('supabase/migrations').sort()) {
    if (!file.endsWith('.sql')) continue;
    await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
    console.log('PASS',file);
  }
  for (const file of ['rls_test.sql','workflow_test.sql']) {
    await db.exec(fs.readFileSync(`supabase/tests/${file}`,'utf8').replace(/^\\.*$/gm,''));
    console.log('PASS',file);
  }
} finally { await db.close(); }
