import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, new URL(request.url).pathname.startsWith('/api/')?0:1);
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

import {database} from './d1.mjs';
import {seal,unseal} from '../worker/index.js';
const newEnv=()=>({DB:database(),AI_ENCRYPTION_KEY:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))});
const request=(path,method='GET',data,user='alice',origin='https://example.test')=>new Request('https://example.test/api/'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),origin,'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(data||{})})});
const call=(env,path,method,data,user,origin)=>worker.fetch(request(path,method,data,user,origin),env);
const connect=env=>call(env,'settings','PUT',{provider:'openai',model:'gpt-4.1-mini',key:'test-only-secret-key'});
test('authentication and request-origin controls protect learning data',async()=>{
 const env=newEnv();assert.equal((await call(env,'state','GET',null,null)).status,401);
 assert.equal((await call(env,'state','PUT',{state:{},revision:0},'alice','https://evil.test')).status,403);
});
test('learning data persists, is user isolated and rejects stale writes',async()=>{
 const env=newEnv();assert.equal((await call(env,'state','PUT',{state:{saved:['hello']},revision:0})).status,200);
 assert.deepEqual((await (await call(env,'state')).json()).state.saved,['hello']);
 assert.equal((await (await call(env,'state','GET',null,'bob')).json()).state,null);
 assert.equal((await call(env,'state','PUT',{state:{saved:[]},revision:0})).status,409);
 assert.deepEqual((await (await call(env,'state')).json()).state.saved,['hello']);
});
test('credentials are encrypted, bound to identity and never returned to client',async()=>{
 const env=newEnv();assert.equal((await connect(env)).status,200);
 const r=await (await call(env,'settings')).json();assert.equal(r.configured,true);assert.equal(r.key,undefined);assert.equal(r.ciphertext,undefined);
 const row=await env.DB.prepare('SELECT ciphertext FROM ai_credentials WHERE user_id=?').bind('alice').first();assert.ok(!row.ciphertext.includes('test-only-secret-key'));
 assert.equal(await unseal(row.ciphertext,env,'alice'),'test-only-secret-key');await assert.rejects(unseal(row.ciphertext,env,'bob'));
 assert.equal((await (await call(env,'settings','GET',null,'bob')).json()).configured,false);
});
test('AI requires own credential; translation sends actual input to configured provider',async()=>{
 const env=newEnv();assert.equal((await call(env,'ai','POST',{task:'translate',input:{text:'合作'}})).status,428);await connect(env);
 let payload;env.TEST_FETCH=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');payload=JSON.parse(options.body);return Response.json({choices:[{message:{content:JSON.stringify({easy:'We can partner.',natural:'Let’s explore a partnership.',executive:'Let’s assess a strategic partnership.',usage:'合作开场',keywords:[{en:'partnership',zh:'合作'}]})}}]})};
 const r=await call(env,'ai','POST',{task:'translate',input:{text:'我们想合作'}});assert.equal(r.status,200);assert.ok(payload.messages[1].content.includes('我们想合作'));assert.equal((await r.json()).result.easy,'We can partner.');
});
test('feedback excludes invented learner errors and provider failures are sanitized',async()=>{
 const env=newEnv();await connect(env);const entry={original:'We want cooperate.',issue:'Missing to',correct:'We want to cooperate.',natural:'We’d like to work together.',executive:'Let’s explore a partnership.',reminder:'Practice linking.',similar:['We want to discuss.'],category:'grammar',review:true};
 env.TEST_FETCH=async()=>Response.json({choices:[{message:{content:JSON.stringify({summary:'复盘',items:[entry,{...entry,original:'made up quote'}],skills:[],nextFocus:['Infinitives']})}}]});
 let r=await call(env,'ai','POST',{task:'feedback',input:{messages:[{role:'user',content:'We want cooperate.'}]}});assert.equal(r.status,200);assert.equal((await r.json()).result.items.length,1);
 env.TEST_FETCH=async()=>new Response('secret upstream content',{status:401});r=await call(env,'test-ai','POST',{});assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret upstream'));
});
test('malformed AI output is rejected rather than rendered or saved',async()=>{
 const env=newEnv();await connect(env);env.TEST_FETCH=async()=>Response.json({choices:[{message:{content:'{"title":"Incomplete"}'}}]});assert.equal((await call(env,'ai','POST',{task:'meeting',input:{text:'Dubai meeting'}})).status,502);
});
test('Drizzle migration files are included in deployment',async()=>{await access(new URL('../dist/.openai/drizzle/0000_common_red_shift.sql',import.meta.url));await access(new URL('../dist/.openai/drizzle/meta/_journal.json',import.meta.url))});
