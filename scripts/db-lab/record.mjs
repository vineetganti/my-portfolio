// Records the real runs behind the Database Engineering posts.
//
//   node scripts/db-lab/record.mjs [spec ...]      needs Docker running
//   ONLY=regex node scripts/db-lab/record.mjs acid re-records only the matching ids
//
// Each file in scripts/db-lab/specs lists what to run. This script runs it for real and writes
// content/db-lab/<spec>.json, which the post components read:
//
//   theaters     several sessions stepping through SQL at once. Waits and deadlocks are real.
//   runs         a script for an engine's own shell, with commands and real output kept apart.
//   charts       async functions that measure something and return chart data.
//   data         async functions returning anything else a simulator replays.
//   playgrounds  the live "Run this" boxes. Their SQL runs here on PGlite, the same engine the
//                reader's browser loads, so a box can't ship with broken SQL.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { pg_visibility } from "@electric-sql/pglite/contrib/pg_visibility";
import { pg_buffercache } from "@electric-sql/pglite/contrib/pg_buffercache";
import { pg_walinspect } from "@electric-sql/pglite/contrib/pg_walinspect";
import { pg_freespacemap } from "@electric-sql/pglite/contrib/pg_freespacemap";
import { bloom } from "@electric-sql/pglite/contrib/bloom";
import { recordRun, recordTheater } from "./lab.mjs";
import { splitSql } from "../../src/components/db/splitSql.ts";

const ROOT = process.cwd();
const SPECS = path.join(ROOT, "scripts/db-lab/specs");
const OUT = path.join(ROOT, "content/db-lab");

async function checkPlaygrounds(file, boxes) {
  const extensions = { pageinspect, pg_visibility, pg_buffercache, pg_walinspect, pg_freespacemap, bloom };
  const db = await PGlite.create({ extensions });
  await db.exec(Object.keys(extensions).map((name) => `CREATE EXTENSION IF NOT EXISTS ${name};`).join("\n"));
  for (const [id, box] of Object.entries(boxes)) {
    const schema = `lab_${file}_${id}`.replace(/\W/g, "_");
    try {
      await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public;`);
      for (const statement of splitSql(box.setup ?? "")) await db.exec(statement);
      for (const sql of [box.query, ...(box.presets ?? []).map((p) => p.sql)]) {
        await db.exec(`SET search_path TO ${schema}, public`);
        for (const statement of splitSql(sql)) {
          await db.exec(statement).catch((e) => {
            if (!box.mayFail) throw e;
          });
        }
      }
      await db.exec("ROLLBACK");
    } catch (e) {
      throw new Error(`playground ${file}/${id}: ${e.message}`);
    }
  }
  await db.close();
}

async function main() {
  const wanted = process.argv.slice(2);
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const pick = (obj) => Object.entries(obj ?? {}).filter(([id]) => !only || only.test(id));
  const specs = fs.readdirSync(SPECS).filter((f) => f.endsWith(".mjs") && (!wanted.length || wanted.includes(f.replace(".mjs", ""))));
  fs.mkdirSync(OUT, { recursive: true });

  for (const f of specs) {
    const file = f.replace(".mjs", "");
    const spec = (await import(pathToFileURL(path.join(SPECS, f)).href)).default;
    const target = path.join(OUT, `${file}.json`);
    const out = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : {};
    out.theaters ??= {};
    out.runs ??= {};
    out.charts ??= {};
    out.data ??= {};

    const save = () => fs.writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
    for (const [id, t] of pick(spec.theaters)) {
      out.theaters[id] = await recordTheater(t);
      save();
      console.log(`  theater ${id}`);
    }
    for (const [id, r] of pick(spec.runs)) {
      out.runs[id] = typeof r === "function" ? await r() : await recordRun(r);
      save();
      console.log(`  run ${id}`);
    }
    for (const [id, measure] of pick(spec.charts)) {
      out.charts[id] = await measure();
      save();
      console.log(`  chart ${id}`);
    }
    for (const [id, measure] of pick(spec.data)) {
      out.data[id] = await measure();
      save();
      console.log(`  data ${id}`);
    }
    fs.writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
    if (spec.playgrounds) {
      await checkPlaygrounds(file, spec.playgrounds);
      out.playgrounds = Object.fromEntries(
        Object.entries(spec.playgrounds).map(([id, box]) => {
          const shipped = { ...box };
          delete shipped.mayFail; // only the checker above needs it
          return [id, shipped];
        }),
      );
      console.log(`  ${Object.keys(spec.playgrounds).length} playgrounds checked on PGlite`);
    }
    fs.writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
    console.log(`${file}: written`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
