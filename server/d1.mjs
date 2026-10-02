import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database(path=':memory:'){
 const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
 sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()){
  if(!sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)){
   sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(file);sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}
  }
 }
 return {sqlite,prepare(sql){let args=[];const self={bind(...values){args=values;return self},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}}}};return self},async batch(items){sqlite.exec('BEGIN');try{const r=[];for(const s of items)r.push(await s.run());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}};
}
