import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {database} from './d1.mjs';

const request=(path,method='GET',value)=>new Request('https://copilot.test/api/'+path,{
  method,
  headers:{origin:'https://copilot.test','content-type':'application/json','oai-authenticated-user-id':'selfhost-owner'},
  ...(method==='GET'?{}:{body:JSON.stringify(value||{})}),
});
function fixture(t){
  const DB=database();
  t.after(()=>DB.sqlite.close());
  const calls=[];
  const env={DB,
    MODEL_SERVICE:{model:'gpt-5.6-sol',
      status:async()=>({configured:true,provider:'strategy',model:'gpt-5.6-sol',managed:true}),
      complete:async messages=>{calls.push(messages);return {reply:'Would you like milk?',hint:'说明偏好',phrases:[]};}},
    TEST_FETCH:()=>assert.fail('Shared mode must not use an API provider'),
    CODEX_COMPLETE:()=>assert.fail('Shared mode must not use a separate Codex account'),
    CODEX_ACCOUNT:()=>assert.fail('Shared mode must not inspect a separate Codex account'),
  };
  return {env,calls,call:(...args)=>worker.fetch(request(...args),env)};
}
test('shared account takes precedence and completes V2 practice without an API key',async t=>{
  const {env,calls,call}=fixture(t);
  assert.deepEqual(await (await call('runtime')).json(),{managed:true,codex:false,selfHosted:true});
  const settings=await (await call('settings')).json();
  assert.equal(settings.configured,true);assert.equal(settings.managed,true);
  assert.equal((await call('settings','PUT',{provider:'openai',key:'unused-test-key'})).status,405);
  const response=await call('ai','POST',{task:'tutor',input:{scene:'Cafe',messages:[{role:'user',content:'A coffee, please.'}]}});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{result:{reply:'Would you like milk?',hint:'说明偏好',phrases:[]},model:'gpt-5.6-sol'});
  assert.equal(calls.length,1);
  assert.match(calls[0][1].content,/A coffee, please/);
  const connection=await (await call('test-ai','POST')).json();
  assert.equal(connection.provider,'strategy');assert.equal(connection.model,'gpt-5.6-sol');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_credentials').get().n,0);
});
test('shared account failure stays in shared mode and never falls back to another provider',async t=>{
  const {env,call}=fixture(t);
  env.MODEL_SERVICE.status=async()=>({configured:false,managed:true,provider:'strategy',model:'gpt-5.6-sol'});
  env.MODEL_SERVICE.complete=async()=>{throw Object.assign(new Error('共用账号暂时不可用，请稍后重试。'),{status:503})};
  const settings=await (await call('settings')).json();
  assert.equal(settings.managed,true);assert.equal(settings.configured,false);
  assert.equal((await call('test-ai','POST')).status,503);
  assert.equal((await (await call('runtime')).json()).managed,true);
});
