/* ============================================================
   思辨实验室 · 把哲学变成能用的思考工具
   纯前端实现，无后端依赖，离线可运行。
   - 模块一：苏格拉底对话（真实大模型优先，离线预设兜底，密钥本地保存）
   - 模块二：无知之幕（罗尔斯式政策议会模拟游戏）
   ============================================================ */

/* ---------- 视图切换 ---------- */
function showView(name, mode) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  const nav = document.querySelector(`.nav-btn[data-view="${name}"]`);
  if (nav) nav.classList.add('active');
  if (mode) setMode(mode);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});
document.querySelectorAll('.card[data-go]').forEach(card => {
  card.addEventListener('click', () => {
    showView(card.dataset.go, card.dataset.mode);
  });
});
document.querySelectorAll('[data-go]:not(.card)').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); showView(el.dataset.go, el.dataset.mode); });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================================================
   模块一 · 苏格拉底对话（真实大模型 + 离线兜底）
   ============================================================ */
const SETTINGS_KEY = 'philo_ai_settings';
const PRESETS = {
  openai:      { endpoint: 'https://api.openai.com/v1/chat/completions',  model: 'gpt-4o-mini' },
  deepseek:    { endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  siliconflow: { endpoint: 'https://api.siliconflow.cn/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V3' },
  ollama:      { endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.1' }
};
const SYSTEM_PROMPT =
  '你是苏格拉底，使用产婆术（elenchus / 助产术）。面对用户提出的任何主张或回答，你只通过提问来追问其概念定义、隐含前提、反例与逻辑后果，绝不给出结论或说教。' +
  '每次只问一个问题，简短、尖锐、善意。如果用户已经回答了你上一个问题，请基于他的回答继续向下追问，而不是重复，让对话能持续多轮、不断深化。' +
  '最关键的一条：你每一步都要紧扣用户最新一句话里的具体内容——引用或 paraphrase 他的原话，再针对那句话追问；绝不要泛泛而谈哲学原理、不要背套路。' +
  '他若反驳或让步，你追问他的底线；他若下绝对判断，你逼问反例；他若下定义，你逼问边界与非例；他若诉诸后果或权威，你追问"有效"与"正当"之分。' +
  '可在贴切时顺带引用你真实对话中的典故（如《申辩篇》的"未经审视的人生不值得过"、《游叙弗伦》中"虔敬为何"的两难、《克力同》对法律的承诺、你自比的"牛虻"），但不要掉书袋，更不要替用户下结论。' +
  '绝对不要以"哲学从这里开始"之类总结式、说教式的话来收尾——始终留一个口子，让对方自己接着想、接着问。' +
  '语气口语、自然，像真人在街边跟你聊，而不是念稿。';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch (e) { return null; }
}
let proxyAvailable = false;
function updateAiStatus() {
  const cfg = loadSettings();
  const el = document.getElementById('aiStatus');
  if (cfg && cfg.apiKey) el.textContent = '当前：你的 Key 真 AI（' + (cfg.model || cfg.endpoint) + '）';
  else if (proxyAvailable) el.textContent = '当前：站点代理真 AI（无需配置，所有人可用）';
  else el.textContent = '当前：离线预设模式（可填自己的 Key 启用真 AI）';
}

/* 设置面板交互 */
const settingsPanel = document.getElementById('settingsPanel');
const providerSelect = document.getElementById('providerSelect');
const endpointInput = document.getElementById('endpointInput');
const keyInput = document.getElementById('keyInput');
const modelInput = document.getElementById('modelInput');

document.getElementById('toggleSettings').addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});
providerSelect.addEventListener('change', () => {
  const p = PRESETS[providerSelect.value];
  if (p) { endpointInput.value = p.endpoint; modelInput.value = p.model; }
});
document.getElementById('saveSettings').addEventListener('click', () => {
  const cfg = {
    endpoint: endpointInput.value.trim(),
    apiKey: keyInput.value.trim(),
    model: modelInput.value.trim()
  };
  if (!cfg.endpoint || !cfg.apiKey || !cfg.model) {
    alert('请完整填写 Endpoint、API Key 与 Model。');
    return;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
  updateAiStatus();
  settingsPanel.classList.add('hidden');
});
document.getElementById('clearSettings').addEventListener('click', () => {
  localStorage.removeItem(SETTINGS_KEY);
  keyInput.value = '';
  updateAiStatus();
  settingsPanel.classList.add('hidden');
});

/* 初始化设置 UI */
(function initSettings() {
  const cfg = loadSettings();
  if (cfg) {
    endpointInput.value = cfg.endpoint || '';
    keyInput.value = cfg.apiKey || '';
    modelInput.value = cfg.model || '';
    for (const k in PRESETS) {
      if (PRESETS[k].endpoint === cfg.endpoint && PRESETS[k].model === cfg.model) { providerSelect.value = k; break; }
    }
  }
  updateAiStatus();
  probeProxy();
})();

/* 对话渲染 */
const chatBox = document.getElementById('chatBox');
const claimInput = document.getElementById('claimInput');
const sendBtn = document.getElementById('sendBtn');
let socratesHistory = [];

function addMessage(role, text) {
  const msg = document.createElement('div');
  msg.className = 'msg ' + role;
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'user' ? '你' : '苏格拉底';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msg.appendChild(who);
  msg.appendChild(bubble);
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function replaceLastBot(text) {
  const bots = chatBox.querySelectorAll('.msg.bot');
  const last = bots[bots.length - 1];
  if (last) last.querySelector('.bubble').textContent = text;
}

/* 调用真实大模型（OpenAI 兼容协议），可传入自定义 system 提示（决策陪练复用） */
async function callLLM(cfg, messages, system = SYSTEM_PROMPT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, ...messages] }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '（模型未返回内容）';
  } finally {
    clearTimeout(timer);
  }
}

/* 站点代理模式（部署后由服务端持 Key 转发，前端不接触密钥，所有人免配置可用） */
const PROXY_CHAT = '/api/chat';
const PROXY_HEALTH = '/api/health';

async function callProxy(messages, system = SYSTEM_PROMPT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(PROXY_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, ...messages] }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      let msg = '代理返回 ' + res.status;
      try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (e2) {}
      throw new Error(msg);
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
      || (data.content) || '（模型未返回内容）';
  } finally {
    clearTimeout(timer);
  }
}

// 页面加载时探测同源代理是否就绪；就绪则自动启用真 AI（无需用户填 Key）
async function probeProxy() {
  try {
    const res = await fetch(PROXY_HEALTH, { method: 'GET' });
    if (res.ok) { const j = await res.json().catch(() => ({})); proxyAvailable = !!(j && j.ok); }
  } catch (e) { proxyAvailable = false; }
  updateAiStatus();
}

/* ============================================================
   离线预设诘问引擎（兜底）
   核心改进：内容驱动——先读懂你这句话在"做什么"
   （下绝对判断 / 下定义 / 诉诸后果 / 诉诸权威 / 举例子 / 说感受 /
   反驳 / 把球抛回来），再针对你的原话追问，且可无限轮接下去，不收尾、不替你下结论。
   ============================================================ */

// 取一句里值得追问的核心片段（去标点、限长），用于"引用你的原话"
function snippet(text, max = 20) {
  const t = text.replace(/[。.，,！!？?；;：:、\s""''「」（）()<>《》]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : (t || text);
}

// 各招式：test 命中用户原话特征；tpl 为针对该特征的若干追问模板（轮换避免重复）
const REACTIVE_MOVES = [
  {
    key: 'meta',
    test: s => /那你|你为什么|你说说|你觉得呢|你告诉我|你怎么看|你来说|你回答|你告诉我啊|你说啊|你先说/.test(s),
    tpl: [
      c => `你想听我说——可这正是关键。在你把球抛回来之前，先说出你心里那句答案：你的版本是什么？说完我再问你。`,
      c => `我如果把答案直接给你，你只会再多一个"别人的说法"。所以不还嘴：回到你那句「${c}」，你真正想问的，其实是哪一个字？`
    ]
  },
  {
    key: 'counter',
    test: s => /不一定|未必|但(是|也)?|不过|可是|然而|除非|其实|问题在于|未必是|我反对|你说的不对|这不对/.test(s),
    tpl: [
      c => `你刚退了一步说「${c}」。好，那退到哪一步你才站稳？你真正不可动摇的底线，到底是什么？`,
      c => `「${c}」——这其实承认了原来那句没那么绝对。那你现在的这个版本，经得起我同样的追问吗？还是只是把问题往后挪了一步？`
    ]
  },
  {
    key: 'abs',
    test: s => /永远|都|所有|一切|每个|任何|必须|一定|绝对|从来|全都|无一|普遍|全部/.test(s),
    tpl: [
      c => `你这句里有一个很重的词——「${c}」中的"都 / 永远"。我先不放过它：有没有哪怕一个例外，会让你收回这句话？一个扛不住反例的主张，往往只是你"希望它成立"。`,
      c => `盯住「${c}」。如果把那个绝对的词拿掉，换成"大多数时候"，你还愿意为它辩护吗？你真正相信的，到底是哪一个版本？`,
      c => `「${c}」——全称量词是哲学里最危险的东西。你凭什么替所有情形打包票？你见过的，真的等于"全部"吗？`
    ]
  },
  {
    key: 'def',
    test: s => /就是|意味|指的?是|等于|即|说白了|无非|应该是|也就是|所谓|概念|定义/.test(s),
    tpl: [
      c => `你说它「${c}」。那我逼一步：有一个东西完全符合你这描述，可常识上明显不是它——你的定义还兜得住吗？定义若分不清"是"与"不是"，就还只是个说法。`,
      c => `把「${c}」反过来想：不属于它的那些东西，凭什么被你挡在门外？你排除它们的根据，和你要定义的东西，真的是同一回事吗？`,
      c => `「${c}」——这是用一组词去解释另一个词。可解释的链条总得有个尽头：你这套说法最后停在哪样东西上，是你真正想清楚的？`
    ]
  },
  {
    key: 'cons',
    test: s => /因为|有用|有效|好处|带来|实用|效率|为了|结果(上|更好|好)|更(好|有效)|后果|收益/.test(s),
    tpl: [
      c => `你给的理由落在「${c}」上——这回答的是"它有用 / 它带来好结果"，不是"它本来就对"。两把尺子推到尽头，量出来的常常不是同一个答案。`,
      c => `假设同样的结果能用另一种完全不一样的方式达到——那时候，你原本的主张还剩什么？是不是你真正在意的，其实只是那个结果？`,
      c => `你说「${c}」，这是后果论的路子。可如果一件"有用"的事，代价是牺牲一个无辜的人，你还会只用"有用"来判它吗？`
    ]
  },
  {
    key: 'auth',
    test: s => /法律|规定|传统|父母|老师|大家|社会|习俗|宗教|神|上帝|国家|政府|权威|书上|课本|专家|历来|从小/.test(s),
    tpl: [
      c => `你搬出了「${c}」。我追一句：它叫你做的，就一定是"该做的"吗？法律、传统、权威，和"正义"从来不是同一件事——苏格拉底在《克力同》里恰恰纠结过这个。`,
      c => `「${c}」凭什么有最后发言权？如果它自己错了、或者它从前也错过，你还要无条件听它的吗？一个没被追问过的权威，你敢把人生交给它？`,
      c => `大家 / 传统都这么认为——可"很多人相信"和"它是真的"之间，隔着整个论证。你想过没有，你信它，是因为它说得通，还是因为从小就被这么教？`
    ]
  },
  {
    key: 'ex',
    test: s => /比如|例如|有一次|我见过|我朋友|我同学|小时候|记得|那次|举个|实例|亲身|我遇到/.test(s),
    tpl: [
      c => `你举了「${c}」这个例子。我盯住它：让你坚持主张的，究竟是这点里的什么？换一种情形，这点还在吗？`,
      c => `这个例子挺具体。但我怀疑它恰好挑了最容易说服你自己的那种情况。有没有一个反例，你其实在心里悄悄略过了？`,
      c => `「${c}」——一个例子再真，也只是一次。你是用它来证明你的主张，还是用你的主张去挑出了这个例子？方向不同，结论完全不同。`
    ]
  },
  {
    key: 'feel',
    test: s => /我觉得|我感觉|我认为|我想|我相信|我喜欢|我觉着|个人觉得|对我来说|在我看来|只是感觉|感觉(这样|那样|自己|不对)/.test(s),
    tpl: [
      c => `你说「${c}」——这是你的感受。可感受和"对"之间隔着一截：你是在描述自己的心情，还是在要求所有人都该这么想？`,
      c => `把"我觉得"换成"它确实是"——你愿意为自己的感觉负责到这一步吗？还是说，你其实只想保留"对我而言"的那份自由？`
    ]
  }
];

// 主题深追（命中关键词时，结合用户原话追加针对性追问）
const TOPIC_DEEP = {
  '说谎|诚实|真话': c =>
    `回到"诚实"——你说「${c}」。一个人为保护无辜者而说谎，和一个人为私利说谎，在你那条标准里真的没有区别吗？如果"目的"能改变对错，那对错是"对的本身"，还是只是"有用的"？`,
  '民主|制度|政治|政府': c =>
    `你说的是制度，原话是「${c}」。请分开两把尺子：你认为它"最优"，是因为它产出更好的结果，还是因为它更尊重人？这两者的根不一样。`,
  '自由|权利': c =>
    `你提到自由，原话「${c}」。当一个人的自由会夺走另一个人活下去的机会时，自由还该是绝对的吗？这条边界，由谁、凭什么来划？`,
  '幸福|快乐': c =>
    `你说的是幸福，原话「${c}」。一个人沉迷短期快乐而毁掉长期生活，他"追求幸福"这句话还成立吗？幸福到底是"当下的感受"，还是"某种更好的生活"？`,
  '惩罚|正义|罪|报复|公平': c =>
    `你谈惩罚，原话「${c}」。请区分"报应"与"矫正"：如果惩罚只是为了"以牙还牙"，那它和犯罪行为在逻辑上到底有什么不同？（这恰是《游叙弗伦》"虔敬为何"的两难）`
};

// 兜底：没命中任何模式时，也始终引用你的原话，做"根据 / 普遍化 / 反例 / 落地"四选一
const FALLBACK_MOVES = [
  c => `你刚说「${c}」。我抓住其中一点问：你用来判断它"对 / 好"的那把尺子，是从哪来的？是你自己想通的，还是别人、或这个时代告诉你的？`,
  c => `盯住「${c}」——如果人人都在类似处境下照你这句话去做、去想，世界会变成什么样子？会不会和你口中的"好"自己打架？`,
  c => `「${c}」——顺着你的逻辑推到底，会不会推出某个连你自己都觉得荒唐的结论？一个推到头会自爆的主张，问题通常出在最早的那一步。`,
  c => `别说太抽象。此刻、此地，有没有一件你正纠结的小事，能用「${c}」帮你想清楚？哲学若落不到具体生活里，就很容易变成一句漂亮话——苏格拉底恰恰是用街头问答把人从漂亮话里拽出来。`
];

const moveState = {};   // 每个招式的轮换计数
let userClaims = [];    // 记录用户每轮原话，用于"前后矛盾"式追问
let offlineTurn = 0;

function pickMoveKeys(text, keys) {
  for (const m of REACTIVE_MOVES) {
    if (keys.includes(m.key) && m.test(text)) {
      const i = (moveState[m.key] = (moveState[m.key] || 0) + 1);
      return m.tpl[(i - 1) % m.tpl.length];
    }
  }
  return null;
}
function pickTopic(text) {
  for (const key in TOPIC_DEEP) {
    if (new RegExp(key).test(text)) return TOPIC_DEEP[key];
  }
  return null;
}

function offlineSocrates(text, turn) {
  const frag = snippet(text);
  // 第一轮：先澄清你这句话里那个核心词到底是什么
  if (turn === 1) {
    const kw = snippet(text, 10);
    return `你刚才说：「${text}」。先停一下——你这句话里这个「${kw}」，你确切指的是什么？能不能拿一个生活里真发生过的例子，把它说清楚？`;
  }
  let fn;
  // 1) 你若把球抛回来 / 反问苏格拉底 —— 先接住这个对话动作
  if ((fn = pickMoveKeys(text, ['meta']))) return fn(frag);
  // 2) 你在反驳 / 让步 —— 追问你的底线
  if ((fn = pickMoveKeys(text, ['counter']))) return fn(frag);
  // 3) 命中核心主题（诚实 / 制度 / 自由 / 幸福 / 正义）—— 结合原话深追
  if ((fn = pickTopic(text))) return fn(frag);
  // 4) 针对你这句话的具体"动作"做反应式追问
  if ((fn = pickMoveKeys(text, ['abs', 'def', 'cons', 'auth', 'ex', 'feel']))) return fn(frag);
  // 5) 你前后主张出现转折 —— 做前后对照
  if (userClaims.length >= 2) {
    const prev = snippet(userClaims[userClaims.length - 2], 16);
    if (/但|不过|其实|不一定|未必|不对|然而|除非/.test(text) && prev) {
      return `你前面说「${prev}」，现在又说「${frag}」——这两句话放在一起，还自洽吗？你是在修正自己，还是两头都想要？`;
    }
  }
  // 6) 兜底：始终引用你的原话，做通用追问（轮换不重复）
  const i = (moveState._fb = (moveState._fb || 0) + 1);
  return FALLBACK_MOVES[(i - 1) % FALLBACK_MOVES.length](frag);
}

/* 发送 */
async function sendSocrates(text) {
  text = (text || '').trim();
  if (!text) return;
  addMessage('user', text);
  claimInput.value = '';
  const cfg = loadSettings();
  if (cfg && cfg.apiKey) {
    // ① 用户自己填了 Key —— 浏览器直连（最高优先级，用户显式选择）
    addMessage('bot', '（正在思考…）');
    try {
      const reply = await callLLM(cfg, [...socratesHistory, { role: 'user', content: text }]);
      replaceLastBot(reply);
      socratesHistory.push({ role: 'user', content: text });
      socratesHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      replaceLastBot('⚠️ 调用大模型失败：' + e.message + '\n可在「API 设置」检查端点与密钥，或清除后使用离线模式。');
    }
  } else if (proxyAvailable) {
    // ② 站点已部署代理 —— 所有人免配置用真 AI（Key 只在服务端，前端不接触）
    addMessage('bot', '（正在思考…）');
    try {
      const reply = await callProxy([...socratesHistory, { role: 'user', content: text }]);
      replaceLastBot(reply);
      socratesHistory.push({ role: 'user', content: text });
      socratesHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      replaceLastBot('⚠️ 代理调用失败：' + e.message + '\n可稍后重试，或清除后使用离线模式。');
    }
  } else {
    // ③ 离线预设兜底
    offlineTurn++;
    userClaims.push(text);
    addMessage('bot', offlineSocrates(text, offlineTurn));
  }
}
sendBtn.addEventListener('click', () => sendSocrates(claimInput.value));
claimInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendSocrates(claimInput.value); });
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => sendSocrates(chip.dataset.ex));
});
document.getElementById('resetBtn').addEventListener('click', () => {
  socratesHistory = [];
  offlineTurn = 0;
  userClaims = [];
  chatBox.innerHTML = '';
});

/* ============================================================
   模块二 · 正义沙盘（无知之幕 · 社会模拟）
   技术构成：Agent-Based 模拟（1000 市民 × 10 代）+ 统计指标
   （基尼系数 / 洛伦兹曲线 / 代际收入弹性）+ 纯 Canvas 手绘可视化。
   ============================================================ */

/* ---------- 政策参数 ---------- */
const PARAM_DEFS = [
  { key: 'tax',     label: '累进税率',           min: 0, max: 60,  step: 1, def: 30, unit: '%', desc: '富人多交、穷人少交的累进程度' },
  { key: 'redist',  label: '再分配强度',         min: 0, max: 100, step: 1, def: 50, unit: '%', desc: '税收向底层转移支付的力度' },
  { key: 'floor',   label: '基本保障底线',       min: 0, max: 100, step: 1, def: 40, unit: '%', desc: '为最困难者托底的最低收入保障' },
  { key: 'edu',     label: '公共教育 / 机会平等', min: 0, max: 100, step: 1, def: 50, unit: '%', desc: '拉平起跑线，提升代际流动' },
  { key: 'health',  label: '全民医疗',           min: 0, max: 100, step: 1, def: 50, unit: '%', desc: '削弱健康劣势对收入的影响' },
  { key: 'market',  label: '市场活力',           min: 0, max: 100, step: 1, def: 50, unit: '%', desc: '更高的整体产出，但也可能拉大差距' }
];
const POLICY_PRESETS = {
  rawls:   { tax: 45, redist: 70, floor: 60, edu: 75, health: 70, market: 45 },
  market:  { tax: 15, redist: 20, floor: 20, edu: 40, health: 30, market: 85 },
  welfare: { tax: 50, redist: 80, floor: 75, edu: 60, health: 80, market: 35 }
};

/* ---------- 可复现随机数（Mulberry32）+ 高斯 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp01 = x => Math.max(0, Math.min(1, x));

/* ---------- 模拟引擎（Agent-Based Model）----------
   1000 名市民 × 10 代演化。每位市民有三项属性：
   天赋 a、继承财富 k、健康 h。每代按政策产生税前收入 → 纳税与
   转移支付 → 税后净收入（预算平衡：net = pre + E·(均值−pre)）；
   财富按 3%/代 复利累积；下一代继承财富与能力，教育会降低这
   种代际传递，从而提升流动性。返回基尼、洛伦兹所需分布、
   代际收入弹性 IGE、底部固化率与底层收入占比等终局指标。
---------------------------------------------------------------- */
function runSimulation(p, seed) {
  const N = 1000, G = 10;
  const rng = mulberry32(seed);
  let agents = [];
  for (let i = 0; i < N; i++) {
    // 初始财富：对数正态 → 天然的不平等（少数人掌握大量资本）
    const u1 = rng(), u2 = rng();
    let k = Math.exp(1.0 * Math.sqrt(-2 * Math.log(u1 + 1e-9)) * Math.cos(2 * Math.PI * u2)) * 18;
    k = Math.max(0.5, k);
    const a = clamp01(0.5 + 0.35 * randn(rng));
    const h = rng() < 0.85 ? 1.0 : 0.4;   // 约 15% 先天处于健康劣势
    agents.push({ a, k, h, income: 0, parentInc: 0, parBottom: false });
  }

  const eqOpp = p.edu / 100;
  const w_a = 0.35 + 0.25 * eqOpp;          // 教育提升"能力/努力"在收入中的权重
  const w_k = 0.65 - 0.35 * eqOpp;          // 教育削弱"继承资本"的权重
  const inheritShare = 0.85 - 0.6 * eqOpp;  // 教育降低资本代际传递比例
  const abilityRegress = 0.5 * (1 - eqOpp); // 教育降低能力/家庭环境的代际传递
  // 预算平衡再分配系数 E：税/再分配/底线共同把净收入拉向均值
  const E = Math.min(1, 0.05 + 0.5 * (p.tax / 100) + 0.45 * (p.redist / 100) + 0.25 * (p.floor / 100));
  const baseMarketBoost = 1 + 0.5 * p.market / 100;   // 市场活力 → 整体产出（饼的大小）

  // 危机干预：从第 shockAt 代起，shock 改变后半程的市场产出与再分配力度
  const shock = p.shock || null;                       // 'market' | 'rescue' | 'redistribute' | null
  const shockAt = (p.shockAt != null) ? p.shockAt : 5;

  // 命运线：一名稳定跟着种子走的市民（揭幕后你就是 ta 的血脉延续）
  const lineageIdx = Math.floor(mulberry32((seed ^ 0x9e3779b9) >>> 0)() * N);
  const lineageInc = new Array(G).fill(0);
  const lineageRank = new Array(G).fill(0);            // 该市民在人群中的收入分位（0~1）

  const giniSeries = [], incByGen = [];
  for (let g = 0; g < G; g++) {
    // 危机后的政策：从第 shockAt 代起生效
    let mkt = baseMarketBoost, eNow = E;
    if (shock && g >= shockAt) {
      if (shock === 'market')            { mkt = baseMarketBoost * 0.82; }                                  // 不干预：产出受挫、自由
      else if (shock === 'rescue')       { mkt = baseMarketBoost * 0.92; eNow = Math.min(1, E + 0.22); }     // 动用储备托底
      else if (shock === 'redistribute') { mkt = baseMarketBoost * 0.88; eNow = Math.min(1, E + 0.38); }     // 加税再分配
    }
    const pre = new Array(N); let sumPre = 0;
    const meanK = agents.reduce((s, x) => s + x.k, 0) / N;
    for (let i = 0; i < N; i++) {
      const ag = agents[i];
      const luck = Math.max(0.6, 1 + 0.18 * randn(rng));               // 生产率冲击
      const effH = ag.h < 1 ? (0.35 + 0.65 * (p.health / 100)) : 1.0;  // 全民医疗抵消健康劣势
      const capFrac = ag.k / (ag.k + 30);                              // 资本边际递减
      let v = 170 * mkt * effH * (w_a * ag.a + w_k * capFrac + 0.06) * luck;
      v = Math.max(0, v);
      pre[i] = v; sumPre += v;
    }
    const mean = sumPre / N;
    const net = new Array(N);
    for (let i = 0; i < N; i++) {
      net[i] = pre[i] + eNow * (mean - pre[i]);   // 预算平衡：净收入向均值收缩
      agents[i].income = net[i];
      agents[i].k = agents[i].k * 1.03;        // 财富复利累积
    }
    // 记录命运线的收入与人群位置
    lineageInc[g] = net[lineageIdx];
    const li = net[lineageIdx];
    let below = 0; for (let i = 0; i < N; i++) if (net[i] <= li) below++;
    lineageRank[g] = below / N;

    giniSeries.push(gini(net));
    incByGen.push(net.slice());
    // 下一代：子女继承并部分回归；教育"拉平"家庭背景
    if (g < G - 1) {
      const parentSorted = net.slice().sort((x, y) => x - y);
      const parThr = quantile(parentSorted, 0.2);
      const next = [];
      for (let i = 0; i < N; i++) {
        const par = agents[i];
        const childA = clamp01((1 - abilityRegress) * 0.5 + abilityRegress * par.a + 0.22 * randn(rng));
        const childH = rng() < 0.85 ? 1.0 : 0.4;
        const childK = inheritShare * par.k + (1 - inheritShare) * meanK;
        next.push({ a: childA, k: Math.max(0.5, childK), h: childH, income: 0, parentInc: par.income, parBottom: par.income <= parThr });
      }
      agents = next;
    }
  }

  // —— 终局指标 ——
  const incs = agents.map(a => a.income);
  const finalSorted = incs.slice().sort((x, y) => x - y);
  const finalThr = quantile(finalSorted, 0.2);
  const n = incs.length;
  const mean = incs.reduce((s, v) => s + v, 0) / n;
  const bottomN = Math.floor(n * 0.2);
  const bottomAvg = finalSorted.slice(0, bottomN).reduce((s, v) => s + v, 0) / bottomN;
  const bottomShare = bottomAvg * bottomN / incs.reduce((s, v) => s + v, 0); // 底层 20% 的收入占比
  // 代际收入弹性 IGE = log(子女收入) 对 log(父母收入) 的回归斜率，越低越流动
  const xs = [], ys = [];
  for (const a of agents) { if (a.parentInc > 0 && a.income > 0) { xs.push(Math.log(a.parentInc)); ys.push(Math.log(a.income)); } }
  let ige = 0;
  if (xs.length > 10) {
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    ige = den ? num / den : 0;
  }
  // 底部固化：父母在底层、子女也落在底层的比例（越低越流动）
  let pb = 0, pbTot = 0;
  for (const a of agents) { if (a.parBottom) { pbTot++; if (a.income <= finalThr) pb++; } }
  const persistence = pbTot ? pb / pbTot : 0;
  return {
    giniSeries, incByGen, agents, ige, persistence, mean, bottomAvg, bottomShare,
    finalGini: giniSeries[G - 1], lineageInc, lineageRank, lineageIdx, shockAt, E, inheritShare
  };
}

function gini(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * a[i];
  let s = 0; for (let i = 0; i < n; i++) s += a[i];
  return s === 0 ? 0 : cum / (n * s);
}
function quantile(sorted, p) {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[idx];
}

/* ---------- 蒙特卡洛稳健性（消除单一种子的运气成分） ---------- */
const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
const stdOf = a => { const m = avg(a); return Math.sqrt(avg(a.map(v => (v - m) * (v - m)))); };
const minArr = a => Math.min(...a);
const maxArr = a => Math.max(...a);

/* 用 k 颗不同种子跑同一套规则，返回"平均轨迹 + 波动区间"，让结论不再依赖运气 */
function runMonteCarlo(p, k, baseSeed, shock) {
  const runs = [];
  for (let i = 0; i < k; i++) {
    runs.push(runSimulation({ ...p, shock: shock || p.shock, shockAt: p.shockAt }, (baseSeed + i * 0x9e3779b1) >>> 0));
  }
  const G = runs[0].giniSeries.length;
  const meanGini = [], bandGiniLo = [], bandGiniHi = [];
  const meanLI = [], bandLILo = [], bandLIHi = [];
  const meanLR = [], bandLRLo = [], bandLRHi = [];
  for (let g = 0; g < G; g++) {
    const gs = runs.map(r => r.giniSeries[g]);
    const li = runs.map(r => r.lineageInc[g]);
    const lr = runs.map(r => r.lineageRank[g]);
    meanGini.push(avg(gs)); bandGiniLo.push(minArr(gs)); bandGiniHi.push(maxArr(gs));
    meanLI.push(avg(li)); bandLILo.push(minArr(li)); bandLIHi.push(maxArr(li));
    meanLR.push(avg(lr)); bandLRLo.push(minArr(lr)); bandLRHi.push(maxArr(lr));
  }
  const finalGini = avg(runs.map(r => r.finalGini));
  const ige = avg(runs.map(r => r.ige));
  const bottomShare = avg(runs.map(r => r.bottomShare));
  const meanInc = avg(runs.map(r => r.mean));
  const persistence = avg(runs.map(r => r.persistence));
  const sc = fairnessScore({ finalGini, ige, bottomShare, mean: meanInc });
  const rep = runs[0]; // 取第一颗种子作为"代表身份"，保证叙事可复现
  return {
    mc: true, k, runs,
    giniSeries: meanGini, bandGiniLo, bandGiniHi,
    lineageInc: meanLI, bandLineageLo: bandLILo, bandLineageHi: bandLIHi,
    lineageRank: meanLR, bandRankLo: bandLRLo, bandRankHi: bandLRHi,
    finalGini, ige, bottomShare, mean: meanInc, persistence,
    agents: rep.agents, lineageIdx: rep.lineageIdx, incByGen: rep.incByGen,
    shockAt: rep.shockAt, E: rep.E, inheritShare: rep.inheritShare,
    score: sc,
    spread: {
      gini: stdOf(runs.map(r => r.finalGini)),
      ige: stdOf(runs.map(r => r.ige)),
      bottom: stdOf(runs.map(r => r.bottomShare)),
      rank: [minArr(runs.map(r => r.lineageRank[G - 1])), maxArr(runs.map(r => r.lineageRank[G - 1]))]
    }
  };
}

/* 杠杆敏感度：对每条规则做 ±15% 扰动，用小规模 MC 估计它对"公平评分"的影响幅度，
   告诉你在这个社会里，哪根杠杆最能左右结果——把一次游玩变成可解释的分析 */
function computeSensitivity(p) {
  const span = d => Math.round((d.max - d.min) * 0.15);
  const base = fairnessScore(runMonteCarlo(p, 6, 0x51a1f3, p.shock)).total;
  return PARAM_DEFS.map(d => {
    const hi = { ...p }, lo = { ...p };
    hi[d.key] = Math.min(d.max, d.def + span(d));
    lo[d.key] = Math.max(d.min, d.def - span(d));
    const hiS = fairnessScore(runMonteCarlo(hi, 6, 0x51a1f3, p.shock)).total;
    const loS = fairnessScore(runMonteCarlo(lo, 6, 0x51a1f3, p.shock)).total;
    return { key: d.key, label: d.label, delta: Math.max(0, Math.abs(hiS - loS)) };
  }).sort((a, b) => b.delta - a.delta);
}



/* ---------- Canvas 可视化 ---------- */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas._w || canvas.width;
  const h = canvas._h || canvas.height;
  if (canvas._scaled !== dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.getContext('2d').scale(dpr, dpr);
    canvas._scaled = dpr; canvas._w = w; canvas._h = h;
  }
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  return canvas.getContext('2d');
}

function drawDistribution(canvas, incs) {
  const ctx = setupCanvas(canvas);
  const W = canvas._w, H = canvas._h;
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 38, r: 12, t: 14, b: 28 };
  const max = Math.max(...incs) * 1.05;
  const bins = 28;
  const counts = new Array(bins).fill(0);
  for (const v of incs) {
    const idx = Math.min(bins - 1, Math.floor(v / max * bins));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  ctx.strokeStyle = '#e0d6c4'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b); ctx.stroke();
  const bw = (W - pad.l - pad.r) / bins;
  for (let i = 0; i < bins; i++) {
    const bh = counts[i] / maxCount * (H - pad.t - pad.b);
    const x = pad.l + i * bw;
    const y = H - pad.b - bh;
    ctx.fillStyle = `rgba(122,74,138,${0.35 + 0.55 * (i / bins)})`;
    ctx.fillRect(x + 1, y, bw - 2, bh);
  }
  ctx.fillStyle = '#6f665a'; ctx.font = '11px sans-serif';
  ctx.fillText('低收入', pad.l, H - 8);
  ctx.fillText('高收入', W - pad.r - 36, H - 8);
  ctx.save(); ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('人数', 0, 0); ctx.restore();
}

function drawGini(canvas, series, prev, band) {
  const ctx = setupCanvas(canvas);
  const W = canvas._w, H = canvas._h;
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 38, r: 12, t: 14, b: 28 };
  const gMax = 0.7;
  ctx.strokeStyle = '#e0d6c4'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b); ctx.stroke();
  const x = i => pad.l + (i / (series.length - 1 || 1)) * (W - pad.l - pad.r);
  const y = gg => H - pad.b - (gg / gMax) * (H - pad.t - pad.b);
  if (band && band.lo && band.hi) {
    ctx.fillStyle = 'rgba(122,74,138,0.10)';
    ctx.beginPath();
    band.hi.forEach((gg, i) => { const xx = x(i); const yy = y(gg); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    for (let i = band.lo.length - 1; i >= 0; i--) { ctx.lineTo(x(i), y(band.lo[i])); }
    ctx.closePath(); ctx.fill();
  }
  if (prev && prev.length) {
    ctx.strokeStyle = 'rgba(201,168,120,0.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath();
    prev.forEach((gg, i) => { const xx = x(i); const yy = y(gg); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = '#7a4a8a'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  series.forEach((gg, i) => { const xx = x(i); const yy = y(gg); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
  ctx.stroke();
  const lx = x(series.length - 1), ly = y(series[series.length - 1]);
  ctx.fillStyle = '#7a4a8a'; ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 7); ctx.fill();
  ctx.fillStyle = '#6f665a'; ctx.font = '11px sans-serif';
  ctx.fillText('0', pad.l - 6, H - pad.b + 12);
  ctx.fillText('基尼', 4, pad.t + 4);
}

function drawLorenz(canvas, incs, g) {
  const ctx = setupCanvas(canvas);
  const W = canvas._w, H = canvas._h;
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 38, r: 14, t: 14, b: 28 };
  const a = incs.slice().sort((x, y) => x - y);
  const n = a.length;
  let s = 0; for (const v of a) s += v;
  const cum = []; let acc = 0;
  for (const v of a) { acc += v; cum.push(acc / s); }
  const xx = i => pad.l + (i / n) * (W - pad.l - pad.r);
  const yy = pp => H - pad.b - pp * (H - pad.t - pad.b);
  ctx.strokeStyle = '#e0d6c4'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, pad.t); ctx.stroke();
  ctx.strokeStyle = '#7a4a8a'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const px = xx(i), py = yy(cum[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.lineTo(xx(n), yy(1)); ctx.stroke();
  ctx.fillStyle = '#6f665a'; ctx.font = '11px sans-serif';
  ctx.fillText('基尼 = ' + g.toFixed(3), pad.l + 6, pad.t + 14);
  ctx.fillText('收入占比', W - pad.r - 50, H - 8);
}

/* 命运轨迹：画一名市民跨代的收入曲线（0..uptoGen 代），可选画波动区间 */
function drawFate(canvas, lineageInc, uptoGen, band) {
  const ctx = setupCanvas(canvas);
  const W = canvas._w, H = canvas._h;
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 12, r: 12, t: 22, b: 16 };
  const data = lineageInc.slice(0, uptoGen + 1);
  const allMax = Math.max(...lineageInc, 1), allMin = Math.min(...lineageInc, 0);
  const max = allMax * 1.1, min = allMin * 0.85, range = (max - min) || 1;
  const x = i => pad.l + (uptoGen ? i / uptoGen : 0) * (W - pad.l - pad.r);
  const y = v => H - pad.b - (v - min) / range * (H - pad.t - pad.b);
  if (band && band.lo && band.hi) {
    ctx.fillStyle = 'rgba(122,74,138,0.10)';
    ctx.beginPath();
    band.hi.slice(0, uptoGen + 1).forEach((v, i) => { const xx = x(i), yy = y(v); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    for (let i = Math.min(uptoGen, band.lo.length - 1); i >= 0; i--) ctx.lineTo(x(i), y(band.lo[i]));
    ctx.closePath(); ctx.fill();
  }
  // 渐变面积
  ctx.beginPath();
  data.forEach((v, i) => { const xx = x(i), yy = y(v); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
  ctx.lineTo(x(data.length - 1), H - pad.b); ctx.lineTo(x(0), H - pad.b); ctx.closePath();
  ctx.fillStyle = 'rgba(122,74,138,0.12)'; ctx.fill();
  // 曲线
  ctx.strokeStyle = '#7a4a8a'; ctx.lineWidth = 2.5; ctx.beginPath();
  data.forEach((v, i) => { const xx = x(i), yy = y(v); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
  ctx.stroke();
  // 当前点
  const cx = x(data.length - 1), cy = y(data[data.length - 1]);
  ctx.fillStyle = '#7a4a8a'; ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#6f665a'; ctx.font = '11px sans-serif';
  ctx.fillText('你这一脉的收入轨迹（越高越好）', pad.l, pad.t - 6);
}

/* 命运文案：根据当前代分位与上一代变化，生成口语化描述 */
function fateCaption(g, rank) {
  const pct = Math.round(rank * 100);
  let move;
  if (g === 0) move = '你刚刚来到这个世界，还不知道自己会落在人群里的什么位置。';
  else {
    const d = rank - (currentRun.lineageRank[g - 1] || 0.5);
    if (d > 0.03) move = '这一代，你比上一代往上走了一段。';
    else if (d < -0.03) move = '这一代，你比上一代往下滑了一段。';
    else move = '这一代，你的位置几乎没有动摇。';
  }
  const where = pct < 20 ? '你处在最底层——一个社会如何对待最不利者，决定你能否活得有尊严。'
    : pct < 50 ? '你在中下层挣扎；能不能往上走，要看这个社会是否留得出流动的缝隙。'
    : pct < 80 ? '你在中上层，但一场变故仍可能把你打回原地。'
    : '你在上层。却也该问问自己：这样的结构，你愿不愿意在「不知自己是谁」时走进去？';
  return `第 ${g + 1} 代 · 你在人群里的位置约第 ${pct} 百分位。${move}${where}`;
}

/* 公平评分：把专业指标翻译成 0~100 分与星级（标签与可见的"平等程度"保持一致） */
function fairnessScore(r) {
  const equal = Math.max(0, Math.min(1, (0.45 - r.finalGini) / (0.45 - 0.05)));     // 不平等程度（基尼越低越好）
  const worstOff = Math.max(0, Math.min(1, (r.bottomShare - 0.12) / (0.26 - 0.12)));  // 最不利者托底
  const mobile = Math.max(0, Math.min(1, (0.18 - r.ige) / (0.18 - 0.04)));            // 出身不锁死命运
  const prosper = Math.max(0, Math.min(1, (r.mean - 70) / (145 - 70)));               // 经济不崩溃（蛋糕大小）
  const total = Math.round(100 * (0.3 * equal + 0.3 * worstOff + 0.2 * mobile + 0.2 * prosper));
  let stars, label;
  if (total >= 80) { stars = 5; label = '罗尔斯会点头：最不利者被托住，出身也不锁死命运。'; }
  else   if (total >= 65) { stars = 4; label = '相当体面：底线稳住了，但仍有更公平的空间。'; }
  else if (total >= 50) { stars = 3; label = '中庸：蛋糕有人分到，也有人被落下。'; }
  else if (total >= 35) { stars = 2; label = '有点放任：赢家通吃，底层多半靠自己。'; }
  else { stars = 1; label = '相当冷酷：你这是在赌自己不会是那个最惨的。'; }
  return { total, stars, label };
}

/* ---------- UI 状态 ---------- */
const MC_K = 24;                 // 蒙特卡洛模式下的重复次数
let mcOn = false;                // 是否开启"跑多次取平均"
let simParams = {};
let lastParams = {};
let chosenShock = null;
let simTimer = null;
let simRunning = false;
let lastRun = null;
let currentRun = null;

function renderSliders() {
  const host = document.getElementById('sliderHost');
  host.innerHTML = PARAM_DEFS.map(d => {
    simParams[d.key] = d.def;
    return `<div class="slider-row" data-key="${d.key}">` +
      `<div class="sr-head"><span class="sr-label">${d.label}</span>` +
      `<span class="sr-val" id="val-${d.key}">${d.def}${d.unit}</span></div>` +
      `<input type="range" id="rng-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${d.def}" />` +
      `<div class="sr-desc">${d.desc}</div></div>`;
  }).join('');
  PARAM_DEFS.forEach(d => {
    const el = document.getElementById('rng-' + d.key);
    el.addEventListener('input', () => {
      simParams[d.key] = +el.value;
      document.getElementById('val-' + d.key).textContent = el.value + d.unit;
    });
  });
}
function applyPreset(name) {
  const ps = POLICY_PRESETS[name]; if (!ps) return;
  PARAM_DEFS.forEach(d => {
    simParams[d.key] = ps[d.key];
    document.getElementById('rng-' + d.key).value = ps[d.key];
    document.getElementById('val-' + d.key).textContent = ps[d.key] + d.unit;
  });
}
document.querySelectorAll('.preset-btn').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));

function showVeilStep(name) {
  ['veilDesign', 'veilSim', 'veilReveal'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== name);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let simResult = null;     // 当前模拟结果（危机选择后会被整体替换）
let simSeed = 0;
let simGen = 0;
let shockChosen = false;

function startSimulation() {
  simSeed = (Date.now() & 0x7fffffff) >>> 0;
  shockChosen = false;
  chosenShock = null;
  simResult = mcOn ? runMonteCarlo({ ...simParams }, MC_K, simSeed, null)
                   : runSimulation({ ...simParams }, simSeed);
  lastParams = { ...simParams };
  currentRun = simResult;
  simRunning = true;
  simGen = 0;
  document.getElementById('toRevealBtn').disabled = true;
  document.getElementById('shockCard').classList.add('hidden');
  document.getElementById('stopSimBtn').disabled = false;
  document.getElementById('stopSimBtn').textContent = '⏸ 暂停';
  showVeilStep('veilSim');
  step();
}

function step() {
  if (!simRunning) return;
  // 第 shockAt 代：暂停，弹出危机决策，等用户选择后再续播后半程
  if (simGen === simResult.shockAt && !shockChosen) {
    simRunning = false;
    document.getElementById('stopSimBtn').disabled = true;
    document.getElementById('shockCard').classList.remove('hidden');
    document.getElementById('shockCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const result = simResult;
  const total = result.giniSeries.length;
  drawDistribution(document.getElementById('distCanvas'), result.incByGen[simGen]);
  const bandG = (result.mc) ? { lo: result.bandGiniLo.slice(0, simGen + 1), hi: result.bandGiniHi.slice(0, simGen + 1) } : null;
  drawGini(document.getElementById('giniCanvas'), result.giniSeries.slice(0, simGen + 1), lastRun ? lastRun.giniSeries : null, bandG);
  if (simGen === total - 1) drawLorenz(document.getElementById('lorenzCanvas'), result.incByGen[simGen], result.giniSeries[simGen]);
  document.getElementById('genNow').textContent = simGen + 1;
  updateMetrics(result, simGen);
  // 命运面板：画你这一脉的轨迹 + 写口语化文案
  const bandF = (result.mc) ? { lo: result.bandLineageLo.slice(0, simGen + 1), hi: result.bandLineageHi.slice(0, simGen + 1) } : null;
  drawFate(document.getElementById('fateCanvas'), result.lineageInc, simGen, bandF);
  document.getElementById('fateGen').textContent = simGen + 1;
  document.getElementById('fateRank').textContent = '第 ' + Math.round(result.lineageRank[simGen] * 100) + ' 百分位';
  document.getElementById('fateCaption').textContent = fateCaption(simGen, result.lineageRank[simGen]);
  simGen++;
  if (simGen < total) {
    simTimer = setTimeout(step, 420);
  } else {
    simRunning = false;
    document.getElementById('toRevealBtn').disabled = false;
    document.getElementById('giniBadge').textContent = result.giniSeries[total - 1].toFixed(3);
  }
}

/* 危机决策：用同一颗种子重跑带 shock 的模拟（前 shockAt 代完全一致），
   再续播后半程——你的选择真实改变了命运线的后半生 */
function chooseShock(choice) {
  shockChosen = true;
  chosenShock = choice;
  simResult = mcOn ? runMonteCarlo({ ...simParams, shock: choice, shockAt: simResult.shockAt }, MC_K, simSeed, choice)
                   : runSimulation({ ...simParams, shock: choice, shockAt: simResult.shockAt }, simSeed);
  currentRun = simResult;
  document.getElementById('shockCard').classList.add('hidden');
  document.getElementById('stopSimBtn').disabled = false;
  simRunning = true;
  document.getElementById('stopSimBtn').textContent = '⏸ 暂停';
  step();
}
document.querySelectorAll('.shock-opt').forEach(b => b.addEventListener('click', () => chooseShock(b.dataset.shock)));
function updateMetrics(result, g) {
  const incs = result.incByGen[g];
  const arr = incs.slice().sort((x, y) => x - y);
  const n = arr.length;
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  const bottomN = Math.floor(n * 0.2);
  const bottomAvg = arr.slice(0, bottomN).reduce((s, v) => s + v, 0) / bottomN;
  const bottomShare = bottomAvg * bottomN / arr.reduce((s, v) => s + v, 0); // 底层 20% 的收入占比
  document.getElementById('mGini').textContent = result.giniSeries[g].toFixed(3);
  document.getElementById('mAvg').textContent = Math.round(mean);
  document.getElementById('mBottom').textContent = Math.round(bottomShare * 100) + '%';
  if (g === result.giniSeries.length - 1) {
    const ige = result.ige;
    const tag = ige < 0.1 ? '很流动' : ige < 0.2 ? '较流动' : ige < 0.35 ? '中等' : '较固化';
    document.getElementById('mMobile').textContent = ige.toFixed(2) + '（' + tag + '）';
    if (lastRun) {
      const d = result.giniSeries[g] - lastRun.giniSeries[lastRun.giniSeries.length - 1];
      const dt = d <= 0 ? '↓ 更平等' : '↑ 更不平等';
      document.getElementById('mDelta').textContent = (d >= 0 ? '+' : '') + d.toFixed(3) + ' ' + dt;
    } else {
      document.getElementById('mDelta').textContent = '首次运行';
    }
  } else {
    document.getElementById('mMobile').textContent = '–';
  }
}

document.getElementById('runSimBtn').addEventListener('click', startSimulation);
document.getElementById('stopSimBtn').addEventListener('click', () => {
  if (simRunning) { simRunning = false; clearTimeout(simTimer); document.getElementById('stopSimBtn').textContent = '▶ 继续'; }
  else { simRunning = true; document.getElementById('stopSimBtn').textContent = '⏸ 暂停'; document.getElementById('toRevealBtn').disabled = true; }
});

/* ---------- 揭幕落点：你的设计最接近哪一种哲学 ---------- */
const PHILO_ARCHETYPES = [
  { key: 'rawls', name: '约翰·罗尔斯', school: '正义即公平',
    vec: { tax: .75, redist: .70, floor: .60, edu: .75, health: .70, market: .45 },
    intro: '20 世纪最具影响力的政治哲学家之一。他主张：判断一个社会公不公平，要在「无知之幕」后面、还不知道自己会成为谁的时候来定；并且只有让最不利者也能获益的制度才正当——他称之为「差别原则」。',
    why: p => `你把再分配拉到 ${p.redist}%、给最困难的人托底 ${p.floor}%，又把大量资源投在教育（${p.edu}%）与医疗（${p.health}%）上——这正契合罗尔斯的思路：宁可蛋糕分得更匀，也要护住最惨的那个人。` },
  { key: 'nozick', name: '罗伯特·诺齐克', school: '自由至上主义',
    vec: { tax: .15, redist: .20, floor: .20, edu: .40, health: .30, market: .85 },
    intro: '罗尔斯的同时代人，却唱反调。他认为人拥有自己——包括身体、劳动和财产；国家只需守住「不偷不抢」的底线，不应为了平均而拿走别人的劳动成果。',
    why: p => `你几乎不碰再分配（${p.redist}%）、把基本保障压到 ${p.floor}%，却把市场活力放到 ${p.market}%——这接近诺齐克的主张：国家只守底线，别为了平均拿走别人的成果。` },
  { key: 'util', name: '边沁与密尔', school: '功利主义',
    vec: { tax: .50, redist: .50, floor: .40, edu: .55, health: .55, market: .60 },
    intro: '从边沁到密尔，这条脉络只认一把尺子：一个选择好不好，看它能不能让「所有人加总的幸福」最大。它不太纠结钱分给谁，只在意总盘子里有没有尽可能多。',
    why: p => `你愿意把市场放到 ${p.market}%、再分配 ${p.redist}%——既想蛋糕大，也想分一点给底层。这正是功利主义的尺子：看全社会总幸福是否最大，不太在意谁拿多拿少。` },
  { key: 'egal', name: '平等主义脉络', school: '结果平等取向',
    vec: { tax: .85, redist: .85, floor: .85, edu: .80, health: .85, market: .25 },
    intro: '这种立场把「结果别差太多」放在第一位：宁可蛋糕小一点，也要把最穷的人牢牢托住。它相信人出生就不平等，所以制度要主动抹平起点与终点。',
    why: p => `你把基本保障（${p.floor}%）、再分配（${p.redist}%）和全民医疗（${p.health}%）都顶得很高——宁愿蛋糕小一点，也要把最穷的人牢牢托住。这就是结果平等取向。` },
  { key: 'merit', name: '贤能主义', school: '机会平等',
    vec: { tax: .35, redist: .30, floor: .25, edu: .90, health: .55, market: .75 },
    intro: '它不追求结果一样，而追求「起跑线一样」：国家该把资源砸在教育与机会上，让人凭本事竞争；至于最后谁跑得快，那是努力和天赋的事。',
    why: p => `你把教育/机会平等拉到 ${p.edu}%，却压低兜底（${p.floor}%）、放开市场（${p.market}%）——重起跑线、轻结果。这是贤能主义：国家砸机会，输赢交给个人努力。` },
  { key: 'darwin', name: '自由放任一脉', school: '社会达尔文主义',
    vec: { tax: .05, redist: .05, floor: .05, edu: .20, health: .15, market: .95 },
    intro: '这一脉把「市场说了算」推到极致：政府最好别插手，输赢交给竞争，能者多得。它听起来冷酷，却真实地回答了一个问题——如果你赌自己会是赢家，你就会选它。',
    why: p => `你把税收（${p.tax}%）、再分配（${p.redist}%）、保障（${p.floor}%）几乎都归零，只把市场顶到 ${p.market}%——交给竞争自己分。这是自由放任/社会达尔文的一脉：能者多得，赌自己会是赢家。` }
];
function normalizeParams(p) {
  return { tax: p.tax / 60, redist: p.redist / 100, floor: p.floor / 100, edu: p.edu / 100, health: p.health / 100, market: p.market / 100 };
}
function classifyPhilosophy(p) {
  const v = normalizeParams(p);
  let best = null, bestD = Infinity;
  for (const a of PHILO_ARCHETYPES) {
    let d = 0;
    for (const k of ['tax', 'redist', 'floor', 'edu', 'health', 'market']) {
      const diff = (v[k] || 0) - (a.vec[k] || 0);
      d += diff * diff;
    }
    d = Math.sqrt(d);
    if (d < bestD) { bestD = d; best = a; }
  }
  return { arche: best, dist: bestD };
}
function renderPhilCard(p, redesigned) {
  const host = document.getElementById('philoCard');
  if (!host) return;
  const { arche } = classifyPhilosophy(p);
  const tag = redesigned ? '改完规则后，你更像一个' : '你的设计，最接近';
  host.innerHTML =
    `<div class="pc-head">${tag}…</div>` +
    `<div class="pc-name">${arche.name} <span class="pc-school">${arche.school}</span></div>` +
    `<div class="pc-intro">${arche.intro}</div>` +
    `<div class="pc-why">${arche.why(p)}</div>` +
    `<div class="pc-method">无论最后把你归入哪一位思想家的脉络，「无知之幕」这个方法都来自罗尔斯——你方才走过的，正是他当年那场思想实验的雏形：在还不知自己将是谁时，去设想一个社会。这两件工具，练的其实是同一种能力：想把一件事想清楚，得先把自己是谁，暂时搁到一旁。</div>`;
}

function reveal() {
  const agents = currentRun.agents;
  const me = agents[currentRun.lineageIdx];   // 揭幕的就是你一直在看的"那名市民"的血脉延续
  const incs = currentRun.incByGen[currentRun.incByGen.length - 1].slice().sort((x, y) => x - y);
  const n = incs.length;
  const g = currentRun.incByGen.length - 1;
  const mc = !!currentRun.mc;
  const rankRep = incs.filter(v => v <= me.income).length / n;
  const rankMean = mc ? currentRun.lineageRank[g] : rankRep;   // 蒙特卡洛：取 24 次随机出生的平均位置
  const bottom = me.income <= incs[Math.floor(n * 0.2)];
  const quin = Math.min(4, Math.floor(rankMean * 5));
  const quinName = ['最底层 20%', '第二档 20%', '中间 20%', '第四档 20%', '顶层 20%'][quin];
  const talent = me.a > 0.62 ? '天赋较高' : me.a < 0.38 ? '天赋平平' : '天赋中等';
  const health = me.h < 1 ? '有健康劣势' : '身体健康';
  const rankTxt = mc
    ? `第 ${Math.round(rankMean * 100)} 百分位（范围 ${Math.round(currentRun.spread.rank[0] * 100)}–${Math.round(currentRun.spread.rank[1] * 100)}）`
    : `第 ${Math.round(rankMean * 100)} 百分位`;
  document.getElementById('identityCard').innerHTML =
    `<div class="label">幕布拉开——你，就是刚才那名市民身后延续的血脉</div>` +
    `<div class="role">一名${health}、${talent}的市民</div>` +
    `<div class="desc">在你设计的制度里，你这一脉的终身收入落在 <strong>${quinName}</strong>，` +
    `收入分位约 ${rankTxt}。${mc ? '这是 24 次随机出生后的平均位置，已把运气摊平。' : ''}${bottom ? '你恰是最容易被制度遗忘的那群人之一。' : ''}</div>`;

  const poor = incs.slice(0, Math.floor(n * 0.2));
  const poorAvg = poor.reduce((s, v) => s + v, 0) / poor.length;
  const mean = incs.reduce((s, v) => s + v, 0) / n;
  let verdict;
  if (rankMean < 0.25) {
    verdict = `如果当初幕布后你"恰好"是底层，你大概不会接受这套制度。按罗尔斯的<em>差别原则</em>，一个制度的首要检验，是它如何对待最不利者——而此刻你就是那个最不利者。`;
  } else if (currentRun.ige > 0.2) {
    verdict = `你落在了中上层，但代际流动性偏低（出身决定命运的指数 IGE=${currentRun.ige.toFixed(2)}）：出身仍在很大程度上决定命运。下一次若你是别人家的孩子，未必还能站在这里。`;
  } else {
    verdict = `你运气不错，落在上层。不过值得一想：在一个流动性更高（IGE 更小）的社会里，你更可能凭自身能力站稳这里，而不必倚仗出身。无知之幕逼问的，正是那句话——你愿不愿意赌自己不会是那个最惨的人。`;
  }
  document.getElementById('reflectBox').innerHTML =
    `最终一代里，最底层 20% 的平均收入仅 <strong>${Math.round(poorAvg)}</strong>，仅为全民平均（${Math.round(mean)}）的 ` +
    `<strong>${Math.round(poorAvg / mean * 100)}%</strong>；这最穷的 20% 人，总共只拿到全社会收入的 ` +
    `<strong>${Math.round(currentRun.bottomShare * 100)}%</strong>。<br><br>${verdict}`;

  // 公平评分卡
  const sc = fairnessScore(currentRun);
  document.getElementById('scoreCard').innerHTML =
    `<div class="score-head">你的社会 · 公平评分${mc ? '（蒙特卡洛均值）' : ''}</div>` +
    `<div class="score-stars">${'★'.repeat(sc.stars)}${'☆'.repeat(5 - sc.stars)}</div>` +
    `<div class="score-num">${sc.total} / 100</div>` +
    `<div class="score-label">${sc.label}</div>`;

  // 杠杆敏感度：告诉用户哪根政策最影响结果（揭幕先渲染，分析稍后异步填入，避免卡顿）
  setTimeout(renderSensitivity, 30);

  lastRun = currentRun;
  document.getElementById('compareBtn').textContent = '查看所有虚拟市民的结局 ▾';
  document.getElementById('compareBox').classList.add('hidden');
  renderRedesign();
  renderPhilCard({ ...lastParams }, false);
  showVeilStep('veilReveal');
}

/* 揭幕：用本地扰动的小规模 MC，估计每条规则对"公平评分"的影响幅度并排序 */
function renderSensitivity() {
  const host = document.getElementById('sensCard');
  if (!host) return;
  const list = computeSensitivity({ ...lastParams, shock: chosenShock || null, shockAt: currentRun.shockAt });
  const maxDelta = Math.max(1, list[0].delta);
  host.innerHTML = '<div class="sens-title">哪根杠杆最影响公平？<span class="sens-sub">对规则做 ±15% 扰动后，公平评分的变动幅度</span></div>' +
    list.map((d, i) => {
      const w = Math.round(d.delta / maxDelta * 100);
      return `<div class="sens-row"><span class="sens-name">${i + 1}. ${d.label}</span>` +
        `<div class="sens-track"><div class="sens-fill" style="width:${w}%"></div></div>` +
        `<span class="sens-val">±${d.delta.toFixed(0)}</span></div>`;
    }).join('');
}

/* 揭幕互动：用同一颗种子重跑，看"同样一个你"因规则变化会落到哪里 */
function computeLineage(run) {
  const me = run.agents[run.lineageIdx];
  const incs = run.incByGen[run.incByGen.length - 1].slice().sort((x, y) => x - y);
  const n = incs.length;
  const rank = incs.filter(v => v <= me.income).length / n;
  const quin = ['最底层 20%', '第二档 20%', '中间 20%', '第四档 20%', '顶层 20%'][Math.min(4, Math.floor(rank * 5))];
  return { rank, quin, income: me.income };
}

function renderRedesign() {
  const host = document.getElementById('redesignHost');
  if (!host) return;
  host.innerHTML = PARAM_DEFS.map(d => {
    const v = (lastParams[d.key] != null) ? lastParams[d.key] : d.def;
    return `<div class="slider-row" data-key="${d.key}">` +
      `<div class="sr-head"><span class="sr-label">${d.label}</span>` +
      `<span class="sr-val" id="rd-val-${d.key}">${v}${d.unit}</span></div>` +
      `<input type="range" id="rd-rng-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" />` +
      `<div class="sr-desc">${d.desc}</div></div>`;
  }).join('');
  PARAM_DEFS.forEach(d => {
    const el = document.getElementById('rd-rng-' + d.key);
    el.addEventListener('input', () => {
      document.getElementById('rd-val-' + d.key).textContent = el.value + d.unit;
    });
  });
  const out = document.getElementById('redesignOut');
  if (out) out.innerHTML = '';
}

function runRedesign() {
  const params = { ...lastParams };
  PARAM_DEFS.forEach(d => {
    const el = document.getElementById('rd-rng-' + d.key);
    if (el) params[d.key] = +el.value;
  });
  if (chosenShock) { params.shock = chosenShock; params.shockAt = currentRun.shockAt; }
  const r2 = runSimulation(params, simSeed); // 同种子：身份/运气/天赋不变，只变规则
  const o1 = computeLineage(currentRun);
  const o2 = computeLineage(r2);
  const diff = Math.round(o2.rank * 100 - o1.rank * 100);
  let verdict;
  if (diff > 1) verdict = `规则一变，你从「第 ${Math.round(o1.rank*100)} 百分位」往上挪到了「第 ${Math.round(o2.rank*100)} 百分位」——你的命运，不止由出身决定，也由规则决定。`;
  else if (diff < -1) verdict = `规则一变，你从「第 ${Math.round(o1.rank*100)} 百分位」滑到了「第 ${Math.round(o2.rank*100)} 百分位」——你定的每一道杠，都在悄悄决定某个"未来的自己"活得怎样。`;
  else verdict = `改了规则，但你这一脉的位置几乎没动（第 ${Math.round(o2.rank*100)} 百分位）——说明你的命运算被出身或运气锁住，规则改得还不够狠，或本来就更靠个人努力。`;
  document.getElementById('redesignOut').innerHTML =
    `<div class="ro-line">原本（你定的规则）：第 <strong>${Math.round(o1.rank*100)}</strong> 百分位 · ${o1.quin}</div>` +
    `<div class="ro-line">改完后（同样一个你）：第 <strong>${Math.round(o2.rank*100)}</strong> 百分位 · ${o2.quin}</div>` +
    `<div class="ro-verdict">${verdict}</div>`;
  renderPhilCard(params, true);
}

/* 生成可分享的"社会名片"文本 */
function buildShareCard() {
  const r = currentRun;
  const sc = fairnessScore(r);
  const me = r.agents[r.lineageIdx];
  const incs = r.incByGen[r.incByGen.length - 1].slice().sort((x, y) => x - y);
  const rank = incs.filter(v => v <= me.income).length / incs.length;
  const quinName = ['最底层 20%', '第二档 20%', '中间 20%', '第四档 20%', '顶层 20%'][Math.min(4, Math.floor(rank * 5))];
  const noteEl = document.getElementById('reflectInput');
  const note = noteEl && noteEl.value.trim();
  const ph = classifyPhilosophy(lastParams).arche;
  return `【我的正义社会 · 无知之幕模拟】
· 不平等程度（基尼）：${r.finalGini.toFixed(3)}　· 出身决定命运（IGE）：${r.ige.toFixed(2)}
· 最穷 1/5 的人，拿到全社会：${Math.round(r.bottomShare * 100)}%
· 人均产出：${Math.round(r.mean)}
· 我的随机身份：落在「${quinName}」（约第 ${Math.round(rank * 100)} 百分位）
· 公平评分：${'★'.repeat(sc.stars)}（${sc.total} 分）
· 我的设计气质：${ph.name}（${ph.school}）
${sc.label}${note ? `\n（我对幕布后的自己说：${note}）` : ''}
—— 思辨实验室 · 你愿意在「不知道自己是谁」时，进入这个社会吗？`;
}
document.getElementById('shareBtn').addEventListener('click', () => {
  const txt = buildShareCard();
  const box = document.getElementById('shareCard');
  box.classList.remove('hidden');
  document.getElementById('shareText').textContent = txt;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(
      () => { document.getElementById('copyShareBtn').textContent = '✅ 已复制'; },
      () => {}
    );
  }
});
document.getElementById('copyShareBtn').addEventListener('click', () => {
  const txt = document.getElementById('shareText').textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(() => { document.getElementById('copyShareBtn').textContent = '✅ 已复制'; });
  }
});
document.getElementById('toRevealBtn').addEventListener('click', reveal);
document.getElementById('redesignBtn').addEventListener('click', runRedesign);

document.getElementById('compareBtn').addEventListener('click', () => {
  const box = document.getElementById('compareBox');
  const btn = document.getElementById('compareBtn');
  if (box.classList.contains('hidden')) {
    const incs = currentRun.agents.map(a => a.income).slice().sort((x, y) => x - y);
    const n = incs.length;
    const quins = [0, 1, 2, 3, 4].map(q => {
      const seg = incs.slice(Math.floor(n * q / 5), Math.floor(n * (q + 1) / 5));
      return seg.reduce((s, v) => s + v, 0) / seg.length;
    });
    const names = ['最底层 20%', '第二档 20%', '中间 20%', '第四档 20%', '顶层 20%'];
    box.innerHTML = names.map((nm, q) => {
      const v = Math.round(quins[q]);
      return `<div class="compare-row"><span class="c-name">${nm}</span>` +
             `<div class="c-track"><div class="c-fill" style="width:${Math.min(100, quins[q] / Math.max(...quins) * 100)}%"></div></div>` +
             `<span class="c-num">${v}</span></div>`;
    }).join('');
    box.classList.remove('hidden');
    btn.textContent = '收起 ▴';
  } else { box.classList.add('hidden'); btn.textContent = '查看所有虚拟市民的结局 ▾'; }
});

document.getElementById('replayBtn').addEventListener('click', () => {
  clearTimeout(simTimer); simRunning = false;
  const ro = document.getElementById('redesignOut'); if (ro) ro.innerHTML = '';
  const ri = document.getElementById('reflectInput'); if (ri) ri.value = '';
  showVeilStep('veilDesign');
});
document.getElementById('veilHomeBtn').addEventListener('click', () => showView('home'));

/* ---------- 蒙特卡洛开关 ---------- */
document.getElementById('mcToggle').addEventListener('change', e => { mcOn = e.target.checked; });

/* ---------- 我的社会档案（localStorage 持久化 + 双社会雷达对比） ---------- */
const SAVE_KEY = 'philo_archive_v1';
function loadArchive() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; } catch (e) { return []; } }
function saveArchive(a) { localStorage.setItem(SAVE_KEY, JSON.stringify(a)); }

function snapshotCurrent() {
  const mc = !!currentRun.mc;
  const g = currentRun.incByGen.length - 1;
  const ph = classifyPhilosophy(lastParams).arche;
  return {
    id: Date.now(),
    time: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    params: { ...lastParams },
    shock: chosenShock || null,
    gini: currentRun.finalGini,
    ige: currentRun.ige,
    bottom: currentRun.bottomShare,
    mean: currentRun.mean,
    rank: mc ? currentRun.lineageRank[g] : computeLineage(currentRun).rank,
    fairness: (mc ? currentRun.score : fairnessScore(currentRun)).total,
    philo: ph.name,
    philoSchool: ph.school
  };
}

function renderArchive() {
  const host = document.getElementById('archiveList');
  if (!host) return;
  const arch = loadArchive();
  if (!arch.length) {
    host.innerHTML = '<div class="archive-empty">这里还是空的。先去跑一次模拟，在揭幕页点 <strong>⭐ 收藏这个社会</strong>，' +
      '它就会存到这里。攒下两个之后，勾选它们，就能在雷达图上并排比较不同制度的取向与结果。</div>';
    return;
  }
  host.innerHTML = arch.slice().reverse().map(s => {
    const rankPct = Math.round((s.rank || 0) * 100);
    return `<div class="arc-item">` +
      `<div class="arc-top"><span class="arc-name">${s.philo}<small>${s.philoSchool}</small></span>` +
      `<span class="arc-time">${s.time}</span></div>` +
      `<div class="arc-stats">公平 ${s.fairness} 分 · 基尼 ${s.gini.toFixed(3)} · 最穷占比 ${Math.round(s.bottom * 100)}% · 你约第 ${rankPct} 百分位</div>` +
      `<div class="arc-actions">` +
      `<button class="ghost sm arc-load" data-id="${s.id}">载入</button>` +
      `<label class="arc-compare"><input type="checkbox" class="arc-cb" value="${s.id}"> 对比</label>` +
      `<button class="ghost sm arc-del" data-id="${s.id}">删除</button>` +
      `</div></div>`;
  }).join('');
  host.querySelectorAll('.arc-load').forEach(b => b.addEventListener('click', () => loadSociety(+b.dataset.id)));
  host.querySelectorAll('.arc-del').forEach(b => b.addEventListener('click', () => {
    saveArchive(loadArchive().filter(x => x.id !== +b.dataset.id)); renderArchive();
  }));
  host.querySelectorAll('.arc-cb').forEach(cb => cb.addEventListener('change', updateCompare));
}

function loadSociety(id) {
  const s = loadArchive().find(x => x.id === id); if (!s) return;
  const ps = s.params;
  PARAM_DEFS.forEach(d => {
    const v = (ps[d.key] != null) ? ps[d.key] : d.def;
    simParams[d.key] = v;
    const el = document.getElementById('rng-' + d.key);
    if (el) { el.value = v; document.getElementById('val-' + d.key).textContent = v + d.unit; }
  });
  showView('veil');
  showVeilStep('veilDesign');
  document.getElementById('archivePanel').classList.add('hidden');
}

let compareSel = [];
function updateCompare() {
  compareSel = Array.from(document.querySelectorAll('.arc-cb:checked')).map(cb => +cb.value).slice(0, 2);
  const canvas = document.getElementById('radarCanvas');
  const cap = document.getElementById('radarCap');
  if (compareSel.length === 2) {
    const a = loadArchive().find(x => x.id === compareSel[0]);
    const b = loadArchive().find(x => x.id === compareSel[1]);
    if (a && b) { drawRadar(canvas, a, b); cap.textContent = `${a.philo}　vs　${b.philo}`; return; }
  }
  const ctx = setupCanvas(canvas); ctx.clearRect(0, 0, canvas._w, canvas._h);
  cap.textContent = '勾选两个社会即可对比（最多 2 个）';
}

function drawRadar(canvas, a, b) {
  const ctx = setupCanvas(canvas);
  const W = canvas._w, H = canvas._h;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 36;
  const axes = [
    { label: '累进税率', v: a.params.tax / 60, v2: b.params.tax / 60 },
    { label: '再分配', v: a.params.redist / 100, v2: b.params.redist / 100 },
    { label: '教育', v: a.params.edu / 100, v2: b.params.edu / 100 },
    { label: '市场', v: a.params.market / 100, v2: b.params.market / 100 },
    { label: '公平分', v: a.fairness / 100, v2: b.fairness / 100 },
    { label: '最穷占比', v: a.bottom / 0.3, v2: b.bottom / 0.3 }
  ];
  const N = axes.length;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / N;
  ctx.strokeStyle = 'rgba(120,110,90,0.25)'; ctx.lineWidth = 1;
  for (let r = 1; r <= 3; r++) {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const th = ang(i % N); const rr = R * r / 3; ctx[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(th), cy + rr * Math.sin(th)); }
    ctx.stroke();
  }
  axes.forEach((ax, i) => {
    const th = ang(i);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(th), cy + R * Math.sin(th)); ctx.stroke();
    ctx.fillStyle = '#6f665a'; ctx.font = '11px sans-serif';
    ctx.textAlign = (Math.abs(Math.cos(th)) < 0.3) ? 'center' : (Math.cos(th) > 0 ? 'left' : 'right');
    ctx.fillText(ax.label, cx + (R + 14) * Math.cos(th), cy + (R + 14) * Math.sin(th) + 4);
  });
  const poly = (valFn, fill, stroke) => {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const th = ang(i % N); const rr = R * Math.max(0, Math.min(1, valFn(axes[i % N]))); const x = cx + rr * Math.cos(th), y = cy + rr * Math.sin(th); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  };
  poly(ax => ax.v2, 'rgba(90,140,180,0.16)', 'rgba(90,140,180,0.9)');
  poly(ax => ax.v, 'rgba(122,74,138,0.16)', 'rgba(122,74,138,0.95)');
}

function saveCurrentSociety() {
  saveArchive(loadArchive().concat(snapshotCurrent()));
  const btn = document.getElementById('saveSocietyBtn');
  const old = btn.textContent; btn.textContent = '✅ 已收藏'; setTimeout(() => btn.textContent = old, 1500);
  renderArchive();
}
document.getElementById('saveSocietyBtn').addEventListener('click', saveCurrentSociety);
const archivePanel = document.getElementById('archivePanel');
document.getElementById('archiveBtn').addEventListener('click', () => {
  renderArchive();
  archivePanel.classList.toggle('hidden');
});
function closeArchive() { archivePanel.classList.add('hidden'); }
document.getElementById('archiveClose').addEventListener('click', closeArchive);
archivePanel.addEventListener('click', e => { if (e.target === archivePanel) closeArchive(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !archivePanel.classList.contains('hidden')) closeArchive(); });

renderSliders();

/* ============================================================
   模块一 · 决策陪练（苏格拉底式四步决策框架）
   把"AI 辅助决策框架"做成可交互的陪练：唱反调（三阶段） /
   四个思维模型 / 5 年后的自己 / 事实 vs 假设 + 低成本测试。
   在线（真 AI）走决策专用系统提示；离线用结构化模板，同样
   引用用户原话、只提问不拍板，保持苏格拉底本色。
   ============================================================ */

const SYSTEM_PROMPT_DECISION =
  '你是苏格拉底式的「决策陪练」，而非普通问答助手。你的核心职责：在重大决策中帮用户打破信息茧房、补全思维盲区、推演潜在风险——但绝不替用户拍板。' +
  '你同时扮演三种角色：①辩论对手（主动唱反调、找漏洞）；②数据分析师（用结构化框架拆解选项的真实代价）；③长期顾问（用长远视角提醒）。' +
  '铁律：一、只提问、列清单或给分析框架，绝不给"你应该选 X"的结论；二、紧扣用户原话，引用或 paraphrase；' +
  '三、警惕自身的"顺从性"——若用户透露了倾向，先找反方证据，绝不要顺着他"和稀泥"；四、涉及具体数据、法律、医疗、财务，提醒用户人工核实，绝不编造证据。' +
  '当用户描述一个决策时，按四步框架引导：第一步唱反调（三阶段：禁止支持全力反驳 → 切换支持视角 → 中立裁判只比强证据）；' +
  '第二步用四个思维模型（选项矩阵、机会成本、最坏推演、沉没成本检测）；第三步以"5 年后的自己"视角给长期建议；第四步区分事实与假设并设计低成本测试。' +
  '始终在结尾留一个口子，让用户自己继续想、继续问。' +
  '语气要像朋友聊天，口语、自然；别用"首先/其次/综上所述"这类套话，也别像教科书或客服念稿。';

const STEP_INSTRUCTION = {
  devil: '请针对用户的决策，严格按以下三阶段输出，不要跳步、不要给结论：\n' +
    '第一阶段（禁止支持，全力反驳）：找出用户遗漏的事实、过度乐观的假设、不可逆成本、机会成本、最坏风险，以及用户是否因情绪或沉没成本在给自己找理由。\n' +
    '第二阶段（切换支持视角）：列出该决定真正成立的核心理由与最强证据，不要为了支持而支持。\n' +
    '第三阶段（中立裁判）：只比较双方证据强度为"强"的论点。告诉我哪边更占优、最大的未知变量是什么、出现什么新信息会让结论反转。不要为了显得客观而强行五五开。',
  matrix: '请用"选项矩阵"帮用户拆解：列出所有可行方案（含"什么都不做"），从成本、收益、风险、可逆性四个维度打分对比，帮用户理清每个选项的真实代价。只列框架与问题，不下结论。',
  opp: '请做"机会成本分析"：假设用户选了他倾向的选项，分析他因此放弃了哪些选项，以及这些被放弃选项的潜在价值是什么。',
  worst: '请做"最坏推演"：对每个选项推演最坏情况、发生概率、用户能否承受、如何降低风险。重点是有没有退路，而非结果是否可怕。',
  sunk: '请做"沉没成本检测"：检查用户的思考是否受了沉没成本影响——是因为已投入时间金钱而倾向继续，还是因为未来真的值得。',
  future: '请以"5 年后的我"的视角给用户建议：你是 5 年后穿越回来的用户，已见过各种结果。分析每个选择的短期与长期影响，并回答"如果重新做一遍，你现在会怎么做"。',
  facts: '请帮用户区分事实与假设，并设计低成本测试：指出分析中哪些是需核实的事实、哪些是用户的假设，提醒涉及数据/法律/医疗/财务需人工核实（AI 可能编造）；并建议几个可承受的现实测试（如投简历、跑 MVP）。'
};
const STEP_LABEL = {
  devil: '第一步 · 反方审查', matrix: '第二步 · 选项矩阵', opp: '第二步 · 机会成本',
  worst: '第二步 · 最坏推演', sunk: '第二步 · 沉没成本检测', future: '第三步 · 5 年后的自己',
  facts: '第四步 · 事实与假设'
};

/* 模式切换：哲学诘问 / 决策陪练 */
function setMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('elenchusPanel').classList.toggle('hidden', mode !== 'elenchus');
  document.getElementById('decisionPanel').classList.toggle('hidden', mode !== 'decision');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

/* 当前 AI 模式：用户 Key / 站点代理 / 离线 */
function aiMode() {
  const cfg = loadSettings();
  if (cfg && cfg.apiKey) return 'userkey';
  if (proxyAvailable) return 'proxy';
  return 'offline';
}

let decisionHistory = [];
const decisionChat = document.getElementById('decisionChat');

function gatherDecision() {
  return {
    title: document.getElementById('decTitle').value.trim(),
    tendency: document.getElementById('decTendency').value.trim(),
    context: document.getElementById('decContext').value.trim(),
    profile: document.getElementById('decProfile').value.trim()
  };
}

function addDecisionMessage(role, text, label) {
  const msg = document.createElement('div');
  msg.className = 'msg ' + role;
  if (label) {
    const lb = document.createElement('div');
    lb.className = 'step-label';
    lb.textContent = label;
    msg.appendChild(lb);
  }
  const who = document.createElement('div');
  who.className = 'who';
  who.textContent = role === 'user' ? '你' : '决策陪练';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msg.appendChild(who);
  msg.appendChild(bubble);
  decisionChat.appendChild(msg);
  decisionChat.scrollTop = decisionChat.scrollHeight;
}
function replaceLastDecisionBot(text) {
  const bots = decisionChat.querySelectorAll('.msg.bot');
  const last = bots[bots.length - 1];
  if (last) last.querySelector('.bubble').textContent = text;
}

function decisionContextBlock() {
  const d = gatherDecision();
  return `【用户的决策背景】\n决定：${d.title || '（未填）'}\n倾向：${d.tendency || '（未填）'}\n背景/限制：${d.context || '（未填）'}` +
    (d.profile ? `\n个人档案：${d.profile}` : '');
}

async function callDecisionLLM(userContent) {
  const cfg = loadSettings();
  const msgs = [...decisionHistory, { role: 'user', content: userContent }];
  if (cfg && cfg.apiKey) return await callLLM(cfg, msgs, SYSTEM_PROMPT_DECISION);
  if (proxyAvailable) return await callProxy(msgs, SYSTEM_PROMPT_DECISION);
  throw new Error('offline');
}

/* 离线结构化模板：引用用户输入、只提问不拍板 */
function offlineDecision(stepKey, d) {
  const t = d.title, ten = d.tendency || '你的倾向';
  switch (stepKey) {
    case 'devil':
      return `【第一阶段 · 先把「${ten}」往最坏里想】
先别忙着替它找理由。咱们反过来：
1. 你想选「${ten}」，会不会只是因为它顺了你的情绪、偷了懒，或者你已经在上面投了太多——说到底，是因为它将来真的值得吗？
2. 你有没有只挑支持它的信息看？反对它的那些证据，你认真找过吗，还是下意识略过去了？
3. 选了它，最输不起的是什么？万一赌错了，还有退路吗？
4. 为了它，你放弃了哪些别的可能？那些被你丢掉的选项，真的一文不值吗？
5. 最坏能坏到哪？概率大不大？真发生了，你扛得住吗？
6. 你是不是在用"都走到这一步了"来给自己洗脑，好让自己别回头？

【第二阶段 · 现在换边，替「${ten}」辩护】
说服我：为什么它真的站得住？只列你自己真心信的证据，别硬凑。你凭什么觉得它比别的选项好？

【第三阶段 · 裁判】
两边最强的证据摆一起：现在哪边更硬？最大的不确定是什么？要是出现什么新消息，你会立刻改主意？别为了显得客观而硬说"各占一半"。
（我不替你下结论——上面只是帮你把正反都摊开。）`;
    case 'matrix':
      return `【选项矩阵】
把「${t}」所有可能列出来，别漏掉"什么都不做"那一个。给每一项从四个角度打分——成本、收益、风险、能不能反悔——各写一句理由：
· 成本：钱、时间、精力，加上你为了它放弃的那些可能
· 收益：眼前能拿到的 + 长远能拿到的
· 风险：失败的概率，和最坏的后果
· 可逆性：错了能不能回头（高 / 中 / 低）
你偏的「${ten}」，在这四项里分别能拿几分？把它和次优的那个并排看，真正的差距到底在哪？`;
    case 'opp':
      return `【机会成本】
假设你最后选了「${ten}」，那被你甩开的是哪些选项？它们最让你心动的地方是什么？
有没有哪一个，长期其实比「${ten}」更值，只是眼下不够诱人？你是压根没看见它，还是懒得算就把它划掉了？`;
    case 'worst':
      return `【最坏推演】
对「${t}」每个可能的选项，老老实实回答：
1. 最坏能坏到什么具体样子？
2. 概率大概多大（高 / 中 / 低）？
3. 真发生了你扛不扛得住，有没有后路？
4. 你能做点什么，把概率或后果压下来？
别盯着"坏得怕不怕人"，要问的是"真到那一步，你还有没有退路"。`;
    case 'sunk':
      return `【沉没成本】
对着「${t}」老实问自己：你想选「${ten}」，是因为"往前看确实更值"，还是因为"都已经搭进去这么多时间、钱、面子，舍不得放手"？
做个假设：把过去所有的投入一笔勾销，当成从没发生过，只看往后，你还会选一样吗？如果答案变了，那你八成是被沉没成本套住了。`;
    case 'future': {
      const prof = d.profile ? '（结合你填的档案说的）' : '（你还没填档案，先给个通用的；填了会更准）';
      return `${prof}
【5 年后的你，回来找你】
"我是 5 年后的你。关于「${t}」，我已经替你把那条路走过了，后来发生的事我都看见了。"
· 当时选「${ten}」，眼前的变化是：……；可站到第 5 年再往回看，真正要命的是另一件事：……
· 要是能重来，5 年后的我会：……（多半你会发现：当初最纠结的，和第 5 年最在意的，根本不是同一件事）
· 给现在的你一句话：……`;
    }
    case 'facts':
      return `【事实 vs 假设 · 先别急着定】
把上面所有分析拆成两类：
1) 哪些是事实，哪些是你的假设。
   · 事实：能搜到、能查证的（数据、政策、行业走向）——别偷懒，一条条去核实，尤其别直接信我说的。
   · 假设：你自己默认"应该没事""多半能成"的那些——列出来，一条条戳。
2) 提醒一句：我为了把话圆回来，可能会编出看起来很对的数据。凡是具体的数字、法律、医疗、钱的事，都得你自己去查。
3) 先别急着下那个最贵、最难回头的选择。设计几个便宜的小实验去试探真实反应：
   · 拿不准要不要走，先投几份简历、跟几家公司聊聊；
   · 拿不准创不创业，先小打小闹跑通一个最小版本。
等现实给了你反馈，再来定。`;
    default:
      return '';
  }
}

/* 离线自由追问：引用用户最新一句 + 上一轮分析，做针对性苏格拉底式追问（不再死路一条） */
function offlineDecisionFollow(text, d, prevBot) {
  const t = d.title || '这个决定';
  const frag = snippet(text);
  const moves = [
    { test: s => /怕|担心|焦虑|不安|舍不得|纠结|犹豫|不敢|退缩/.test(s),
      tpl: c => `你刚说「${c}」——这里面有几分是"事实上的风险"，几分是你对未知的本能不安？先把情绪和判断分开：若只凭理性、把害怕先放一边，你还会做同样的选择吗？` },
    { test: s => /钱|成本|花|贵|工资|收入|存款|经济|财务|亏|月薪|房价/.test(s),
      tpl: c => `你提到「${c}」。别只看直接的钱：选了它，你放弃了哪些"也能赚钱或省钱"的别的选项（机会成本）？这笔投入若全打了水漂，你兜得住吗、有没有退路？` },
    { test: s => /家人|父母|朋友|大家|别人|同事|对象|伴侣|社会|应该|都说|他们/.test(s),
      tpl: c => `你搬出了「${c}」。我追一句：这是你自己的判断，还是把家人/周围人的期待当成了你自己的？如果没人会知道你的选择、也没人会对你指指点点，你还会这么选吗？` },
    { test: s => /肯定|一定|必须|绝对|当然|没错|毫无疑问|显然|本来就该/.test(s),
      tpl: c => `「${c}」说得很满。给我一个反例，或一个"什么新信息出现会让你改主意"的条件——一个扛不住反例的结论，往往只是你希望它成立。` },
    { test: s => /因为|所以|为了|目的是|理由是|我觉得对|值得|划算/.test(s),
      tpl: c => `你给的理由是「${c}」。它回答的是"有用 / 带来好结果"，还是"本来就该做"？两把尺子推到底，量出来的常常是不同答案——你想守的是哪一把？` }
  ];
  for (const m of moves) if (m.test(text)) return m.tpl(frag);
  const lead = prevBot ? `上一轮我帮你列了正反，你刚回应说「${frag}」。` : `关于「${t}」，你刚说「${frag}」。`;
  return lead + `现在逼自己一句：三年后回头看，你最怕的是"选错了"，还是"因为没敢选、一直想着如果"？把这个怕写清楚，比算出对错更重要。`;
}

async function runDecisionStep(stepKey) {
  const d = gatherDecision();
  if (!d.title) { alert('请先填写"我正在考虑的决定"。'); return; }
  addDecisionMessage('user', STEP_LABEL[stepKey], STEP_LABEL[stepKey]);
  if (aiMode() !== 'offline') {
    addDecisionMessage('bot', '（正在思考…）');
    const userContent = decisionContextBlock() + '\n\n【本次任务】\n' + STEP_INSTRUCTION[stepKey];
    try {
      const reply = await callDecisionLLM(userContent);
      replaceLastDecisionBot(reply);
      decisionHistory.push({ role: 'user', content: userContent });
      decisionHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      replaceLastDecisionBot('⚠️ 调用失败：' + e.message + '\n可检查 API 设置或等待站点代理，或清除后使用离线模板。');
    }
  } else {
    addDecisionMessage('bot', offlineDecision(stepKey, d));
  }
}

const ALL_ORDER = ['devil', 'matrix', 'opp', 'worst', 'sunk', 'future', 'facts'];
const MODEL_KEYS = ['matrix', 'opp', 'worst', 'sunk'];

/* 批量运行若干步骤：在线时逐条调用真 AI 并把上下文串起来；离线时用结构化模板。
   与单步 runDecisionStep 不同，这里不插入"用户标签"气泡，直接以步骤标签附在每条分析上，避免成堆气泡。 */
async function runSteps(keys) {
  const d = gatherDecision();
  if (!d.title) { alert('请先填写"我正在考虑的决定"，或点上面的示例自动填入。'); return; }
  if (aiMode() !== 'offline') {
    for (const k of keys) {
      addDecisionMessage('bot', '（正在生成：' + STEP_LABEL[k] + ' …）', STEP_LABEL[k]);
      try {
        const userContent = decisionContextBlock() + '\n\n【本次任务】\n' + STEP_INSTRUCTION[k];
        const reply = await callDecisionLLM(userContent);
        replaceLastDecisionBot(reply);
        decisionHistory.push({ role: 'user', content: userContent });
        decisionHistory.push({ role: 'assistant', content: reply });
      } catch (e) {
        replaceLastDecisionBot('⚠️ 调用失败：' + e.message + '\n可检查 API 设置或等待站点代理，或清除后使用离线模板。');
      }
    }
  } else {
    for (const k of keys) addDecisionMessage('bot', offlineDecision(k, d), STEP_LABEL[k]);
  }
}

async function runAllSteps() {
  const btn = document.getElementById('runAllBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ 正在逐条生成…';
  await runSteps(ALL_ORDER);
  btn.disabled = false;
  btn.textContent = '▶ 再跑一遍五步';
}

async function runModels() {
  await runSteps(MODEL_KEYS);
}

document.querySelectorAll('[data-step]').forEach(b => {
  b.addEventListener('click', () => runDecisionStep(b.dataset.step));
});
document.querySelectorAll('.model-btns [data-model]').forEach(b => {
  b.addEventListener('click', () => runDecisionStep(b.dataset.model));
});
document.getElementById('runModelsBtn').addEventListener('click', runModels);
document.getElementById('runAllBtn').addEventListener('click', runAllSteps);

async function sendDecisionFollow() {
  const input = document.getElementById('decFollowInput');
  const text = input.value.trim();
  if (!text) return;
  const d = gatherDecision();
  input.value = '';
  addDecisionMessage('user', text);
  if (aiMode() !== 'offline') {
    addDecisionMessage('bot', '（正在思考…）');
    const userContent = decisionContextBlock() + '\n\n用户的追问：' + text;
    try {
      const reply = await callDecisionLLM(userContent);
      replaceLastDecisionBot(reply);
      decisionHistory.push({ role: 'user', content: userContent });
      decisionHistory.push({ role: 'assistant', content: reply });
    } catch (e) {
      replaceLastDecisionBot('⚠️ 调用失败：' + e.message);
    }
  } else {
    const bots = decisionChat.querySelectorAll('.msg.bot');
    const prevBot = bots.length ? bots[bots.length - 1].querySelector('.bubble').textContent : '';
    addDecisionMessage('bot', offlineDecisionFollow(text, d, prevBot));
  }
}
document.getElementById('decFollowBtn').addEventListener('click', sendDecisionFollow);
document.getElementById('decFollowInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendDecisionFollow(); });
document.getElementById('decResetBtn').addEventListener('click', () => {
  decisionHistory = [];
  decisionChat.innerHTML = '';
});

document.querySelectorAll('.decision-examples .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.getElementById('decTitle').value = chip.dataset.dtitle || '';
    if (chip.dataset.dtend) document.getElementById('decTendency').value = chip.dataset.dtend;
    document.getElementById('decTitle').focus();
  });
});
