import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync} from 'node:fs';
// One private owner per deployment. No shell, file, or approval requests are exposed to the browser.
export class CodexBridge{
 constructor({command='codex',home,workspace,timeout=120000,spawnProcess=spawn}={}){this.options={command,home,workspace,timeout,spawnProcess};this.pending=new Map();this.listeners=new Set();this.sequence=0;this.busy=false;this.starting=null;}
 async start(){if(this.starting)return this.starting;this.starting=this.initialize();try{await this.starting}catch(e){this.starting=null;throw e}}
 async initialize(){const {command,home,workspace,spawnProcess}=this.options;mkdirSync(home,{recursive:true,mode:0o700});mkdirSync(workspace,{recursive:true,mode:0o700});this.child=spawnProcess(command,['app-server',...['shell_tool','unified_exec','apps','plugins','remote_plugin','browser_use','browser_use_external','computer_use','code_mode_host','view_image','image_generation','multi_agent','tool_suggest','sleep_tool'].flatMap(k=>['-c','features.'+k+'=false']),'-c','web_search="disabled"','-c','features.skip_host_skill_discovery=true'],{cwd:workspace,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:home,LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
 this.child.on('error',()=>this.fail(new Error('Codex 服务无法启动，请检查服务器安装。')));this.child.on('exit',()=>{this.starting=null;this.fail(new Error('Codex 服务已断开，请重新连接。'))});this.child.stderr.on('data',()=>{});
 createInterface({input:this.child.stdout}).on('line',line=>{try{this.receive(JSON.parse(line))}catch{/* ignore non-protocol log lines */}});
 await this.request('initialize',{clientInfo:{name:'global_copilot',title:'Global Copilot',version:'2.0.0'}});this.notify('initialized',{});
 }
 receive(message){if(message.id!==undefined&&message.method){this.child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Tool and approval requests are disabled in Global Copilot.'}})+'\n');return}if(message.id!==undefined){const p=this.pending.get(message.id);if(p){clearTimeout(p.timer);this.pending.delete(message.id);message.error?p.reject(new Error('ChatGPT 请求失败，请检查授权或额度后重试。')):p.resolve(message.result)}return}for(const cb of this.listeners)cb(message);}
 fail(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error)}this.pending.clear();for(const cb of this.listeners)cb({method:'bridge/error',error})}
 notify(method,params){this.child.stdin.write(JSON.stringify({method,params})+'\n')}
 request(method,params){return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('ChatGPT 请求超时，请重试。'))},this.options.timeout);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n')})}
 async account(){await this.start();return this.request('account/read',{refreshToken:true})}
 async login(){await this.start();const r=await this.request('account/login/start',{type:'chatgptDeviceCode'});const u=new URL(r.verificationUrl);if(u.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(u.hostname))throw new Error('授权地址异常');return {loginId:r.loginId,userCode:r.userCode,verificationUrl:r.verificationUrl}}
 async logout(){await this.start();return this.request('account/logout',{})}
 async complete(messages){if(this.busy)throw Object.assign(new Error('上一条回复仍在生成，请稍后再试。'),{status:429});this.busy=true;let threadId,listener,timer;
 try{await this.start();const account=await this.account();if(!account.account)throw Object.assign(new Error('请先连接你的 ChatGPT 账号。'),{status:428});const r=await this.request('thread/start',{cwd:this.options.workspace,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,baseInstructions:'You are a text-only English coach. Never use tools, execute commands, read files, browse, or modify the environment. Return only the requested JSON.'});threadId=r.thread.id;
 const output=new Promise((resolve,reject)=>{let text='';listener=m=>{if(m.method==='bridge/error')return reject(m.error);if(m.params?.threadId!==threadId)return;if(m.method==='item/completed'&&m.params.item?.type==='agentMessage')text=m.params.item.text;if(m.method==='turn/completed'){if(m.params.turn?.status!=='completed')return reject(new Error('ChatGPT 未完成回复，请检查额度并重试。'));try{resolve(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,'')))}catch{reject(new Error('ChatGPT 返回格式不完整，请重试。'))}}};this.listeners.add(listener);timer=setTimeout(()=>{this.request('turn/interrupt',{threadId,turnId:this.turnId}).catch(()=>{});reject(new Error('ChatGPT 回复超时，输入已保留。'))},this.options.timeout)});
 // Attach rejection handler before awaiting turn/start so timeouts cannot become unhandled.
 output.catch(()=>{});
 const turn=await this.request('turn/start',{threadId,approvalPolicy:'never',sandboxPolicy:{type:'readOnly',networkAccess:false},input:[{type:'text',text:JSON.stringify(messages)}]});this.turnId=turn.turn.id;return await output;
 }finally{clearTimeout(timer);if(listener)this.listeners.delete(listener);this.busy=false;if(threadId)this.request('thread/archive',{threadId}).catch(()=>{})}}
 close(){this.child?.kill();this.starting=null}
}
