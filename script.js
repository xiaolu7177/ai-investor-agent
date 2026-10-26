/* ============================================================
 * AI 投资人 Agent · 前端
 * 约定：所有 AI 端点 fetch 必须带 makers-conversation-id 头
 * ============================================================ */

const CONV_KEY = 'eo_conversation_id';

const els = {
  messages: document.getElementById('messages'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  reset: document.getElementById('reset'),
};

const state = {
  messages: [],      // { role, content } —— 只在客户端保留用于渲染
  streaming: false,
  aborted: false,
  controller: null,
};

/* ---------------- 会话 ID ---------------- */
function getOrCreateConversationId() {
  let id = localStorage.getItem(CONV_KEY);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(CONV_KEY, id);
  }
  return id;
}

function rotateConversationId() {
  const id = (crypto.randomUUID && crypto.randomUUID()) || `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(CONV_KEY, id);
  return id;
}

/* ---------------- Markdown（轻量渲染，够用即可） ---------------- */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return t;
}

function markdown(src) {
  // 模型有时会把「前置说明」和首个标题/列表拼在同一行，先补换行让结构能正常渲染
  const normalized = String(src || '')
    .replace(/\r\n/g, '\n')
    .replace(/([。！？；!?;])(#{2,6}\s)/g, '$1\n\n$2')
    .replace(/([。！？；!?;])([-*]\s)/g, '$1\n$2');
  const lines = normalized.split('\n');
  const out = [];
  let listType = null;
  let inCode = false;
  let codeBuf = [];

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = []; inCode = false;
      } else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    if (!line.trim()) { closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = Math.min(h[1].length + 1, 6); // # -> h2, ### -> h4 视觉更协调
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); out.push('<hr>'); continue; }

    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inCode && codeBuf.length) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  closeList();

  let html = out.join('');
  // 报价高亮：¥xx 万 / 白送都不要
  html = html.replace(
    /(¥\s?\d[\d,.]*\s?[万亿]?)/g,
    '<span class="price">$1</span>',
  );
  html = html.replace(/(白送都不要)/g, '<span class="price zero">$1</span>');
  return html;
}

/* ---------------- DOM 渲染 ---------------- */
function scrollToBottom(force = false) {
  const m = els.messages;
  const nearBottom = m.scrollHeight - m.scrollTop - m.clientHeight < 160;
  if (force || nearBottom) m.scrollTop = m.scrollHeight;
}

function addRow(role, html, opts = {}) {
  const row = document.createElement('div');
  row.className = `row ${role === 'user' ? 'user' : 'bot'}`;

  const av = document.createElement('div');
  av.className = 'avatar';
  av.textContent = role === 'user' ? '🙋' : '🤑';

  // 列容器：状态条（工具调用）+ 气泡，两者互不覆盖
  const col = document.createElement('div');
  col.className = 'col';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (opts.raw) bubble.textContent = html;
  else bubble.innerHTML = html;

  col.appendChild(bubble);
  row.appendChild(av);
  row.appendChild(col);
  els.messages.appendChild(row);
  scrollToBottom(true);
  return { bubble, col, row };
}

function showHero() {
  els.messages.innerHTML = '';
  const hero = document.createElement('div');
  hero.className = 'hero';
  hero.innerHTML = `
    <div class="big">🤑</div>
    <h2>来说说你的副业点子</h2>
    <p>我是老陈，看了 3000+ 项目的老投资人。<br>你说想法，我联网查竞品，然后给你一个数字——或者一句「白送都不要」。</p>
    <div class="samples" id="samples"></div>
  `;
  els.messages.appendChild(hero);

  const samples = [
    ['🧾', 'AI 帮你写朋友圈文案的小程序', '面向微商和小店主，9.9 元包月'],
    ['🐱', '给猫做性格测评 + 定制玩具订阅盒', '月付 69 元，主打情绪价值'],
    ['📚', 'AI 把网课自动剪成短视频切片', '卖给知识博主，按条收费'],
  ];
  const box = hero.querySelector('#samples');
  samples.forEach(([emoji, title, desc]) => {
    const d = document.createElement('div');
    d.className = 'sample';
    d.innerHTML = `<b>${emoji} ${title}</b><br>${desc}`;
    d.addEventListener('click', () => {
      els.input.value = `${title}。${desc}`;
      autosize();
      submit();
    });
    box.appendChild(d);
  });
}

function setSending(on) {
  state.streaming = on;
  els.send.disabled = false;
  els.send.textContent = on ? '停止' : '发出去';
  els.send.classList.toggle('stop', on);
  els.input.disabled = false;
}

/* ---------------- 发送 & 流式接收 ---------------- */
async function submit() {
  if (state.streaming) return;
  const text = els.input.value.trim();
  if (!text) return;

  const hero = els.messages.querySelector('.hero');
  if (hero) hero.remove();

  els.input.value = '';
  autosize();

  state.messages.push({ role: 'user', content: text });
  addRow('user', text, { raw: true });
  setSending(true);

  // 机器人消息（状态条 + 气泡）
  const bot = addRow('bot', '<span class="typing"><i></i><i></i><i></i></span>');
  const bubble = bot.bubble;
  let botText = '';
  let firstToken = true;
  let sawDone = false;
  let toolChip = null;

  // 逐 token 重渲染 Markdown 会卡（一次回复 800+ 事件），节流到 80ms
  let lastPaint = 0;
  let paintTimer = null;
  const paint = (force = false) => {
    if (force || Date.now() - lastPaint > 80) {
      lastPaint = Date.now();
      bubble.innerHTML = markdown(botText);
      scrollToBottom();
      return;
    }
    if (paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      lastPaint = Date.now();
      bubble.innerHTML = markdown(botText);
      scrollToBottom();
    }, 80);
  };

  state.aborted = false;
  const controller = new AbortController();
  state.controller = controller;

  try {
    const resp = await fetch('/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'makers-conversation-id': getOrCreateConversationId(),
      },
      body: JSON.stringify({
        messages: state.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: controller.signal,
    });

    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => '');
      throw new Error(friendlyError(resp.status, detail));
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { sawDone = true; break; }
        if (!payload) continue;

        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }

        if (evt.type === 'ai_response' && evt.content) {
          if (firstToken) { bubble.innerHTML = ''; firstToken = false; }
          botText += evt.content;
          paint();
        } else if (evt.type === 'tool_call') {
          if (!toolChip) {
            toolChip = document.createElement('span');
            toolChip.className = 'toolchip';
            bot.col.insertBefore(toolChip, bubble);
          }
          toolChip.textContent = `🔍 正在联网核实：${friendlyTool(evt.name)}`;
          scrollToBottom();
        } else if (evt.type === 'tool_result') {
          if (toolChip) {
            toolChip.textContent = '✅ 已核实竞品与市场';
          }
          scrollToBottom();
        } else if (evt.type === 'suggest_actions' && Array.isArray(evt.actions)) {
          renderChips(evt.actions);
        } else if (evt.type === 'error_message') {
          if (firstToken) { bubble.innerHTML = ''; firstToken = false; }
          botText += `\n\n> ⚠️ ${evt.content}`;
          paint(true);
        }
      }
    }

    if (!sawDone && !state.aborted) {
      if (!botText) bubble.innerHTML = markdown('> ⚠️ 连接中断，请点「发出去」重试');
    }

    if (botText.trim()) {
      state.messages.push({ role: 'assistant', content: botText });
    } else {
      // 失败的这一轮不能把用户消息留在历史里（否则下一轮变成两条连续 user）
      state.messages.pop();
      if (!sawDone) bubble.innerHTML = markdown('> ⚠️ 这轮没收到回复，直接再问一次就行');
    }
  } catch (e) {
    const aborted = e?.name === 'AbortError' || state.aborted;
    if (aborted) {
      if (!botText) {
        bubble.innerHTML = markdown('> ⏹ 已打断');
        state.messages.pop();
      } else {
        state.messages.push({ role: 'assistant', content: botText });
      }
    } else {
      bubble.innerHTML = markdown(`> ⚠️ 出错了：${e?.message || '未知错误'}`);
      state.messages.pop();
    }
  } finally {
    if (paintTimer) { clearTimeout(paintTimer); paintTimer = null; }
    if (botText.trim()) paint(true);
    state.controller = null;
    setSending(false);
    els.input.focus();
    scrollToBottom();
  }
}

function friendlyTool(name) {
  if (!name) return '搜索';
  if (name.includes('search')) return '搜索竞品与市场';
  return name;
}

/** 把后端原始报错翻译成人话，别让用户看一串 JSON */
function friendlyError(status, raw) {
  let msg = '';
  try {
    msg = JSON.parse(raw)?.error || '';
  } catch { /* 非 JSON */ }

  if (msg.includes('AI_GATEWAY_API_KEY') || msg.includes('AI_GATEWAY_BASE_URL')) {
    return '服务器还没配模型密钥（AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL），配好这两个环境变量我就能开口了。';
  }
  if (status === 500) return `服务器 500：${msg || raw.slice(0, 120)}`;
  if (status === 404) return '后端路由没找到（/chat 没部署上去）。';
  return msg || `HTTP ${status} ${raw.slice(0, 120)}`;
}

function renderChips(actions) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  actions.forEach((a) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = a;
    btn.addEventListener('click', () => {
      els.input.value = a;
      autosize();
      submit();
      wrap.remove();
    });
    wrap.appendChild(btn);
  });
  els.messages.appendChild(wrap);
  scrollToBottom();
}

/* ---------------- 交互 ---------------- */
function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 132)}px`;
}

els.input.addEventListener('input', autosize);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

els.send.addEventListener('click', async () => {
  if (state.streaming) {
    state.aborted = true;
    try {
      if (state.controller) state.controller.abort();
      await fetch('/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // /stop 绝不带 makers-conversation-id
        body: JSON.stringify({ conversation_id: getOrCreateConversationId() }),
      });
    } catch { /* ignore */ }
    return;
  }
  submit();
});

els.reset.addEventListener('click', () => {
  if (state.streaming) return;
  rotateConversationId();
  state.messages = [];
  showHero();
  els.input.focus();
});

/* ---------------- 启动 ---------------- */
getOrCreateConversationId();
showHero();
autosize();
els.input.focus();
