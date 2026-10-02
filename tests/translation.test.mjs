import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {database} from '../server/d1.mjs';

function fixture(t,complete){
  const DB=database();t.after(()=>DB.sqlite.close());
  const env={DB,MODEL_SERVICE:{model:'gpt-5.6-sol',complete}};
  return input=>worker.fetch(new Request('https://test.example/api/ai',{
    method:'POST',headers:{origin:'https://test.example','content-type':'application/json','oai-authenticated-user-id':'alice'},
    body:JSON.stringify({task:'translate_zh',input}),
  }),env);
}
test('Chinese translation sends the exact sentence and context through the shared account',async t=>{
  const call=fixture(t,async messages=>{
    const request=JSON.parse(messages[1].content);
    assert.equal(request.task,'translate_zh');
    assert.equal(request.input.text,'Would you like it to go?');
    assert.equal(request.input.context[0].content,'A coffee, please.');
    assert.match(messages[0].content,/Do not answer the question/);
    return {translation:'  您要打包带走吗？  '};
  });
  const response=await call({text:'Would you like it to go?',context:[{role:'user',content:'A coffee, please.'}]});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{result:{translation:'您要打包带走吗？'},model:'gpt-5.6-sol'});
});
test('invalid translation requests never invoke the model',async t=>{
  const call=fixture(t,()=>assert.fail('Invalid source must be rejected before inference'));
  for(const text of [null,'   ',{},'x'.repeat(8001)])assert.equal((await call({text})).status,400);
});
test('missing, empty or malformed translations are rejected',async t=>{
  let result;
  const call=fixture(t,async()=>result);
  for(result of [{},{translation:''},{translation:'   '},{translation:{}},{translation:'x'.repeat(12001)}]){
    assert.equal((await call({text:'Hello.'})).status,502);
  }
});
