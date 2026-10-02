import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hashPassword} from '../server/auth.mjs';
test('private server enforces login, CSRF, signed cookies and strips spoofed identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'copilot-server-'));const origin='http://localhost:43991';
 const child=spawn(process.execPath,['server/index.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,APP_ORIGIN:origin,PORT:'43991',MODEL_BACKEND:'api',DATA_DIR:dir,SESSION_SECRET:'test-session-secret-at-least-32-characters',OWNER_PASSWORD_HASH:hashPassword('my-test-only-password'),AI_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')},stdio:['ignore','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start')),5000);child.once('error',reject);child.stdout.on('data',d=>{if(d.toString().includes('server ready')){clearTimeout(timer);resolve()}})});
 const anon=await fetch(origin+'/api/state');assert.equal(anon.status,401);
 const bad=await fetch(origin+'/auth/login',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({password:'my-test-only-password'})});assert.equal(bad.status,403);
 const login=await fetch(origin+'/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:'my-test-only-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
 const put=await fetch(origin+'/api/state',{method:'PUT',headers:{origin,cookie,'content-type':'application/json','oai-authenticated-user-id':'spoofed-user'},body:JSON.stringify({revision:0,state:{saved:['restored record']}})});assert.equal(put.status,200);
 const read=await(await fetch(origin+'/api/state',{headers:{cookie}})).json();assert.deepEqual(read.state.saved,['restored record']);
 const injection=await fetch(origin+'/api/state',{headers:{'oai-authenticated-user-id':'private-owner'}});assert.equal(injection.status,401);
 const page=await fetch(origin+'/',{headers:{cookie,accept:'text/html'}});assert.equal(page.status,200);assert.ok((await page.text()).includes('root'));
 }finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));rmSync(dir,{recursive:true,force:true})}
});
