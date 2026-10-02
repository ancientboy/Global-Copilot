import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// D1-compatible adapter; application queries and original migrations stay intact.
export function database(path) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()) {
    if (sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)) continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
      sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(name);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const make = args => ({
        bind(...values) { return make(values); },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        execute() { return { success: true, meta: { changes: Number(statement.run(...args).changes) } }; },
        async run() { return this.execute(); },
      });
      return make([]);
    },
    async batch(items) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = items.map(item => item.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
