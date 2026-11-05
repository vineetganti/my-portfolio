/**
 * Splits SQL into statements the way psql does: at a semicolon outside quotes, dollar quotes and
 * comments. Running them one at a time means VACUUM works beside other statements, and an error
 * leaves the results of everything before it on screen.
 */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    const dollar = /^\$\w*\$/.exec(sql.slice(i));
    const quote = dollar ? dollar[0] : sql[i] === "'" ? "'" : null;
    if (quote) {
      const close = sql.indexOf(quote, i + quote.length);
      const stop = close === -1 ? sql.length : close + quote.length;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql[i] === ";") {
      out.push(`${current};`);
      current = "";
    } else {
      current += sql[i];
    }
    i++;
  }
  out.push(current);
  return out.filter((s) => s.replace(/--[^\n]*/g, "").replace(/;/g, "").trim());
}
