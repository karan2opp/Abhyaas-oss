import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "../common/db/schema.js";

// Drift report between the app schema (source of truth) and the connected DB.
// Set DATABASE_URL to the target (e.g. production Neon) and run:
//   npx tsx src/scripts/db-inspect.ts
// Read-only: only introspects information_schema, never modifies anything.

const db = drizzle(process.env.DATABASE_URL!);

const expected: Map<string, string[]> = new Map();
for (const value of Object.values(schema)) {
  try {
    const cols = Object.values(getTableColumns(value as any)).map((c: any) => c.name);
    expected.set(getTableName(value as any), cols);
  } catch {
    // not a table (pgEnum / type / helper) — skip
  }
}

(async () => {
  const tablesRes: any = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
  const dbTables = new Set<string>((tablesRes.rows || []).map((r: any) => r.table_name as string));

  const colsRes: any = await db.execute(sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
  const dbCols = new Map<string, Set<string>>();
  for (const row of colsRes.rows || []) {
    if (!dbCols.has(row.table_name)) dbCols.set(row.table_name, new Set());
    dbCols.get(row.table_name)!.add(row.column_name);
  }

  console.log("=== Drift report (schema vs DB) ===");

  const missingTables = [...expected.keys()].filter((t) => !dbTables.has(t));
  const extraTables = [...dbTables].filter((t) => !expected.has(t));

  if (missingTables.length === 0) {
    console.log("Tables: OK - all expected tables exist.");
  } else {
    console.log("MISSING TABLES (push will CREATE these):");
    missingTables.forEach((t) => console.log(`  + ${t}`));
  }

  if (extraTables.length === 0) {
    console.log("Extra tables: none.");
  } else {
    console.log("EXTRA TABLES in DB but NOT in schema (push will DROP these - check data first!):");
    extraTables.forEach((t) => console.log(`  - ${t}`));
  }

  console.log("--- Column drift (expected columns missing in existing tables) ---");
  let anyMissingCols = false;
  for (const [table, cols] of expected) {
    if (!dbTables.has(table)) continue;
    const missing = cols.filter((c) => !dbCols.get(table)?.has(c));
    if (missing.length > 0) {
      anyMissingCols = true;
      console.log(`  ${table}: MISSING ${missing.join(", ")} (push will ADD)`);
    }
  }
  if (!anyMissingCols) console.log("  (none - all expected columns present)");

  console.log("Done.");
  process.exit(0);
})().catch((e) => {
  console.error("Inspect failed:", e.message);
  process.exit(1);
});