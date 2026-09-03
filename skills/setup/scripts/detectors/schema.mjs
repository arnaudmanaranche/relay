// Database schema source detection.
//
// Produces the `schemaFiles` config list: the files that describe what the
// database actually looks like today. agent-runner.ts injects their contents
// into the Architect's and Dev's prompts, because neither agent can read the
// repo itself — Dev runs with no filesystem tools at all, so a table or
// column it never saw is one it invents.
//
// Two deliberate limits:
//
// - Only well-known locations are checked, no repo-wide search. A false
//   positive here costs prompt budget on every single Architect and Dev
//   call for the life of the project, so "ask the user" beats "guess
//   broadly" — same posture as detectLintCmd returning '' rather than
//   assuming ESLint.
//
// - A declarative schema (Prisma, Drizzle, a checked-in schema.sql,
//   generated DB types) is preferred over migration history. It describes
//   the current state in one file, which is exactly the question an agent
//   needs answered; a migrations directory answers it only by replaying
//   every file in order. Migrations are still included when they're the
//   ONLY signal, as a `dir/*.sql` glob agent-runner.ts expands to the most
//   recent few.

import { exists, ls, isDirectory } from './fs-helpers.mjs';

// Single files that declare the whole current schema, in preference order.
const DECLARATIVE_CANDIDATES = [
  'prisma/schema.prisma',
  'schema.prisma',
  'db/schema.ts',
  'src/db/schema.ts',
  'drizzle/schema.ts',
  'src/drizzle/schema.ts',
  'app/db/schema.ts',
  'server/db/schema.ts',
  'db/schema.sql',
  'schema.sql',
  'sql/schema.sql',
];

// Generated type definitions — not the schema itself, but the shape the
// application code actually compiles against, which is what makes a wrong
// column name a typecheck failure instead of a runtime one.
const GENERATED_TYPE_CANDIDATES = [
  'database.types.ts',
  'types/database.types.ts',
  'types/supabase.ts',
  'src/types/database.types.ts',
  'src/types/supabase.ts',
  'lib/database.types.ts',
  'lib/supabase/types.ts',
  'app/types/database.types.ts',
];

// Directories of ordered .sql migrations.
const MIGRATION_DIR_CANDIDATES = [
  'supabase/migrations',
  'migrations',
  'db/migrations',
  'database/migrations',
  'drizzle/migrations',
  'prisma/migrations',
];

function hasSqlFiles(root, dir) {
  return ls(root, dir).some(name => name.endsWith('.sql'));
}

// `prisma/migrations/<timestamp>_<name>/migration.sql` — one level deeper
// than every other convention, so a plain `*.sql` glob would find nothing.
function prismaMigrationGlob(root, dir) {
  const hasNestedSql = ls(root, dir).some(
    name => isDirectory(root, `${dir}/${name}`) && exists(root, dir, name, 'migration.sql')
  );
  return hasNestedSql ? `${dir}/*/migration.sql` : null;
}

export function detectSchemaFiles(root) {
  const found = [];

  for (const candidate of DECLARATIVE_CANDIDATES) {
    if (exists(root, candidate)) found.push(candidate);
  }
  for (const candidate of GENERATED_TYPE_CANDIDATES) {
    if (exists(root, candidate)) found.push(candidate);
  }

  // A Prisma or Drizzle project's migrations add nothing an agent can use
  // that its declarative schema doesn't already state more clearly, so
  // they're only worth the prompt budget when nothing declarative was
  // found at all.
  if (found.length === 0) {
    for (const dir of MIGRATION_DIR_CANDIDATES) {
      if (!isDirectory(root, dir)) continue;
      if (hasSqlFiles(root, dir)) {
        found.push(`${dir}/*.sql`);
        continue;
      }
      const nested = prismaMigrationGlob(root, dir);
      if (nested) found.push(nested);
    }
  }

  return found;
}
