import {createInterface} from 'node:readline/promises';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {hashPassword} from './auth.mjs';
// Run interactively on your own server. Never commit the resulting private configuration.
const rl=createInterface({input:process.stdin,output:process.stdout});const origin=await rl.question('HTTPS domain (for example https://english.example.com): ');const password=await rl.question('Choose a private workspace password (12+ characters): ');rl.close();if(password.length<12||!origin.startsWith('https://'))throw new Error('HTTPS and a 12+ character password are required.');
await writeFile('.env',`APP_ORIGIN=${origin}\nOWNER_PASSWORD_HASH=${hashPassword(password)}\nSESSION_SECRET=${randomBytes(48).toString('hex')}\nAI_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nMODEL_BACKEND=codex\nDATA_DIR=/data\n`,{mode:0o600,flag:'wx'});console.log('Private server configuration created. Keep .env private.');
