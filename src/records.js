import {api} from './service';
export async function listRecords(kind){let cursor=0,out=[];for(;;){const r=await api(`records?kind=${kind}&cursor=${cursor}`);out.push(...r.items);if(r.next===null)return out;cursor=r.next}}
export async function putRecord(kind,value){const r=await api('records',{method:'PUT',body:JSON.stringify({kind,id:value.id,revision:value.revision||0,value})});return {...value,revision:r.revision}}
export async function tutor(task,input){return (await api('ai',{method:'POST',body:JSON.stringify({task,input})})).result}
