import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const errors = {
  login_required: [503, '共享 GPT 账号需要重新登录，请联系管理员。'],
  access_denied: [503, '共享 GPT 账号暂时无权使用 GPT 5.6 Sol。'],
  rate_limited: [429, '共享 GPT 账号触发限流或额度限制，请稍后重试。'],
  account_queue_timeout: [429, '共享账号持续繁忙，等待空位超时，请稍后重试。'],
  queue_full: [429, '已有多项训练等待处理，请稍后再提交。'],
  queue_timeout: [504, '前面的训练尚未完成，本次排队已超时，请重新提交。'],
  model_timeout: [504, '模型生成超时，输入已保留，请缩短内容或重试。'],
  invalid_output: [502, '模型返回内容不完整，请重试。'],
  model_connection_error: [502, '模型连接中断，请稍后重试。'],
  bridge_unavailable: [503, '工作台模型服务暂时无法连接，请稍后重试。'],
  model_unavailable: [502, '模型服务暂时异常，请稍后重试。'],
};
const failure = code => {
  const [status, message] = errors[code] || errors.model_unavailable;
  return Object.assign(new Error(message), { status, code: errors[code] ? code : 'model_unavailable' });
};

// FIFO admission is per workbench. It never takes strategy's single-request gate.
export function strategyModel(directory, { queueTimeoutMs = 90000, maxWaiting = 3, completionTimeoutMs = 235000 } = {}) {
  const model = 'gpt-5.6-sol';
  let cached, cachedAt = 0, active = false;
  const waiting = [];
  function enter() {
    if (!active) { active = true; return Promise.resolve(); }
    if (waiting.length >= maxWaiting) return Promise.reject(failure('queue_full'));
    return new Promise((resolve, reject) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(failure('queue_timeout'));
      }, queueTimeoutMs);
      waiting.push(entry);
    });
  }
  function leave() {
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); }
    else active = false;
  }
  function call(payload) {
    return new Promise((resolve, reject) => {
      let token;
      try { token = readFileSync(join(directory, 'token'), 'utf8').trim(); } catch { reject(failure('bridge_unavailable')); return; }
      const body = payload ? JSON.stringify(payload) : null;
      if (body && Buffer.byteLength(body) > 131072) { reject(Object.assign(new Error('训练内容过长，请缩短后重试。'), { status: 413 })); return; }
      let settled = false, timer;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const req = request({ socketPath: join(directory, 'model.sock'), path: body ? '/complete' : '/status', method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, res => {
        let size = 0; const chunks = [];
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 131072) { finish(failure('invalid_output')); req.destroy(); }
          else chunks.push(chunk);
        });
        res.on('error', () => finish(failure('model_connection_error')));
        res.on('aborted', () => finish(failure('model_connection_error')));
        res.on('end', () => {
          let result;
          try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finish(failure('invalid_output')); return; }
          if (!result || typeof result !== 'object' || Array.isArray(result)) { finish(failure('invalid_output')); return; }
          if (res.statusCode !== 200) {
            const fallback = { 401: 'bridge_unavailable', 403: 'access_denied', 429: 'rate_limited', 504: 'model_timeout', 503: 'model_unavailable' };
            finish(failure(errors[result.error] ? result.error : fallback[res.statusCode] || 'model_unavailable'));
          } else finish(null, result);
        });
      });
      // An absolute timer also covers a provider that sends occasional bytes forever.
      timer = setTimeout(() => { finish(failure(body ? 'model_timeout' : 'bridge_unavailable')); req.destroy(); }, body ? completionTimeoutMs : 10000);
      req.on('error', () => finish(failure('bridge_unavailable')));
      req.end(body);
    });
  }
  return {
    model,
    async status() {
      if (!cached || Date.now() - cachedAt >= 15000) {
        try {
          const result = await call();
          cached = { configured: !!result.authenticated && result.models?.includes(model), provider: 'strategy', model, managed: true, channel: result.channel || 'dedicated' };
          cachedAt = Date.now();
        } catch (error) { return { configured: false, provider: 'strategy', model, managed: true, error: error.message }; }
      }
      return { ...cached, processing: active, waiting: waiting.length };
    },
    async complete(input) {
      await enter();
      try {
        const result = await call({ model, system_prompt: input.filter(m => m.role === 'system').map(m => m.content).join('\n'), context: { messages: input.filter(m => m.role !== 'system') }, output_schema: { type: 'object' } });
        if (typeof result.content !== 'string' || !(result.model === model || result.model?.startsWith(model + '-'))) throw failure('invalid_output');
        try { return JSON.parse(result.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw failure('invalid_output'); }
      } finally { leave(); }
    },
  };
}
