import {DatabaseSync,backup} from 'node:sqlite';
import {resolve} from 'node:path';
const destination=process.argv[2];if(!destination)throw new Error('Pass a private destination file path.');
const db=new DatabaseSync(resolve(process.env.DATA_DIR||'private-data','learning.sqlite'));await backup(db,destination);db.close();console.log('Consistent learning database backup written.');
