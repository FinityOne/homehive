/**
 * Proves every table this repo creates in `public` is also granted to the
 * Data API roles, in version control.
 *
 * Worth a script rather than a reading: Supabase stopped auto-granting new
 * tables in `public` on 30 October 2026, and the failure is silent in exactly
 * the places we look. The migration applies cleanly. The table is really
 * there. `list_tables` shows it. Types generate for it. The only symptom is a
 * `permission denied` from supabase-js at runtime, on a feature that worked
 * the whole time it was being built, because the developer's own database
 * still carried the old default ACL. A forgotten GRANT should fail here, in
 * a second, and not there.
 *
 * Deliberately static — it reads the migrations, not a database. The question
 * is whether the repo *asks* for the grant, and a database that still has the
 * withdrawn default would answer yes either way.
 *
 * Run: npm run verify:grants
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../supabase/migrations/', import.meta.url).pathname

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

/** Drop `--` and block comments so prose about a table never counts as SQL. */
const strip = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')

// Where each table is created, and where each one is granted.
const createdIn = new Map() // table -> migration file
const grantedIn = new Map() // table -> migration file

for (const file of files) {
  const sql = strip(readFileSync(join(DIR, file), 'utf8'))

  for (const m of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi,
  )) {
    if (!createdIn.has(m[1])) createdIn.set(m[1], file)
  }

  // `grant <privs> on [table] public.x, public.y to <roles>;` — the role list
  // has to name both API roles to count. Granting only to service_role leaves
  // the table invisible to the app's own browser and SSR clients.
  for (const m of sql.matchAll(
    /grant\s+[^;]*?\son\s+(?:table\s+)?((?:public\.[a-z0-9_]+\s*,?\s*)+)to\s+([^;]+);/gi,
  )) {
    const roles = m[2].toLowerCase()
    if (!roles.includes('anon') || !roles.includes('authenticated')) continue
    for (const t of m[1].matchAll(/public\.([a-z0-9_]+)/gi)) {
      if (!grantedIn.has(t[1])) grantedIn.set(t[1], file)
    }
  }
}

const pass = []
const fail = []

// ── Every table the repo creates is granted somewhere in the repo ──────────
for (const [table, file] of [...createdIn].sort()) {
  const grant = grantedIn.get(table)
  if (grant) pass.push(`${table} — created in ${file}, granted in ${grant}`)
  else
    fail.push(
      `${table} — created in ${file}, NEVER granted. Add to that migration:\n` +
        `      grant all on public.${table} to anon, authenticated, service_role;`,
    )
}

// ── The catch-up migration is still here and still covers the schema ───────
const CATCH_UP = '20261102020000_data_api_grants.sql'
if (!files.includes(CATCH_UP)) {
  fail.push(
    `${CATCH_UP} is missing — the 54 tables that predate this directory lose their declared grants`,
  )
} else {
  const n = [...grantedIn.values()].filter((f) => f === CATCH_UP).length
  if (n >= 62) pass.push(`${CATCH_UP} declares grants for ${n} tables`)
  else fail.push(`${CATCH_UP} declares grants for only ${n} tables, expected at least 62`)
}

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed`)
for (const p of pass) console.log(`  ✓ ${p}`)
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`)
  for (const f of fail) console.log(`  ✗ ${f}`)
  console.log(
    '\nSupabase no longer grants new tables in `public` automatically.\n' +
      'A table without a GRANT answers `permission denied` to supabase-js,\n' +
      'PostgREST and GraphQL however permissive its RLS policies are.\n',
  )
  process.exit(1)
}
console.log('\n✓ every table this repo creates can be reached by the Data API\n')
