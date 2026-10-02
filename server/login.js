const base = location.pathname.slice(0, -'auth/login'.length);
let token = new URLSearchParams(location.hash.slice(1)).get('setup') || '';
history.replaceState(null, '', location.pathname);
const byId = id => document.getElementById(id);
let setup = false;
async function initialize() {
  try {
    const response = await fetch(base + 'auth/status');
    if (!response.ok) throw new Error('暂时无法连接，请刷新重试。');
    setup = !(await response.json()).configured;
    byId('title').textContent = setup ? '创建你的登录密码' : '欢迎回来';
    byId('description').textContent = setup ? '设置至少 6 个字符的密码，以后在电脑和手机上均可使用。' : '登录你的私人商务英语工作台。';
    byId('confirmation').hidden = !setup;
    byId('confirm').required = setup;
    byId('password').autocomplete = setup ? 'new-password' : 'current-password';
    byId('submit').textContent = setup ? '创建账号并进入' : '登录';
    byId('submit').disabled = setup && !token;
    if (setup && !token) byId('error').textContent = '请使用发给你的专属首次设置链接。';
  } catch (error) { byId('error').textContent = error.message; }
}
byId('login').addEventListener('submit', async event => {
  event.preventDefault();
  byId('error').textContent = '';
  if (setup && byId('password').value !== byId('confirm').value) { byId('error').textContent = '两次输入的密码不一致。'; return; }
  byId('submit').disabled = true;
  try {
    const response = await fetch(base + (setup ? 'auth/setup' : 'auth/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: byId('password').value, ...(setup ? { token } : {}) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '登录失败，请重试。');
    token = '';
    location.replace(base);
  } catch (error) { byId('error').textContent = error.message; byId('submit').disabled = false; }
});
initialize();
