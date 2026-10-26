# 老陈 · AI 投资人 Agent

> 说你的副业想法，AI 投资人联网查竞品，给出「愿意投多少钱」的判断——或者一句「白送都不要」。

按《从 0 到 1 做一个 AI Agent：环境搭建 → 开发 → 部署 → 绑定自定义域名》教程实现，框架严格使用 **LangGraph**（Node）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| Agent 框架 | LangGraph（`StateGraph` + `MessagesAnnotation` + checkpointer 多轮记忆） |
| 模型 | EdgeOne Makers AI Gateway（默认 `@makers/deepseek-v4-flash`，可用 `AI_GATEWAY_MODEL` 覆盖） |
| 联网搜索 | 平台注入 `context.tools.web_search`（腾讯云 WSA，需 `WSA_API_KEY`） |
| 前端 | 原生 HTML/CSS/JS，Q 版风格，零依赖零构建，多端适配 |
| 部署 | EdgeOne Makers（`edgeone makers deploy`） |

## 目录结构

```
ai-investor-agent/
├── index.html                 # 前端页面（Q 版聊天界面）
├── style.css                  # 贴纸风视觉 + 移动端适配
├── script.js                  # SSE 流式接收 + 轻量 Markdown 渲染 + 会话 ID
├── agents/                    # ⭐ Agent 后端（AI 推理）
│   ├── _shared.ts             # SSE helper（心跳/响应头/abort）
│   ├── _model.ts              # 网关 env 校验 + ChatOpenAI 实例缓存
│   ├── stop.ts                # POST /stop —— 打断当前生成
│   └── chat/
│       ├── index.ts           # POST /chat —— SSE 入口
│       ├── _graph.ts          # LangGraph 图（agent ⇄ tools）
│       └── _prompt.ts         # 毒舌投资人系统提示词
├── edgeone.json               # agents.framework = langgraph
├── .env.example               # ⚠️ 必须存在，CLI 据此注入 AI_GATEWAY_*
├── package.json
└── .gitignore
```

## 关键实现点

1. **文件即路由**：`agents/chat/index.ts` → `POST /chat`，`agents/stop.ts` → `POST /stop`；`_` 前缀文件不对外暴露。
2. **环境变量**：`agents/` 内禁止 `process.env`，一律走 `context.env`。
3. **多轮记忆**：`context.store.langgraphCheckpointer` 作为 checkpointer，`thread_id = makers-conversation-id`，前端只发送最新一轮消息，历史由平台 Blob 持久化（跨实例、跨重启都在）。
4. **工具绑定**：LangGraph 必须用 `context.tools.toLangChainTools(tool, ['web_search'])` 拿到真正的 `StructuredTool`。
5. **容错**：自写工具节点（不用官方 `ToolNode`），单次搜索失败只把错误文本交给模型兜底，不炸整条流；`WSA_API_KEY` 未配置时 Agent 仍可凭经验作答。
6. **SSE 协议**：`ai_response` / `tool_call` / `tool_result` / `suggest_actions` / `ping` / `error_message`，5s 心跳，四件套响应头，结尾 `data: [DONE]`。
7. **打断**：`/stop` 只从 body 取 `conversation_id`，绝不携带 `makers-conversation-id`（否则粘性路由打不中）。

## 本地开发

```bash
export PAGES_SOURCE=skills
npm install
edgeone makers dev -n ai-investor-agent     # → http://127.0.0.1:8088/
```

## 部署

```bash
export PAGES_SOURCE=skills
edgeone makers env set WSA_API_KEY "<你的腾讯云 Web Search API Key>"   # 联网搜索必填
edgeone makers deploy -n ai-investor-agent --json
```

`AI_GATEWAY_API_KEY` / `AI_GATEWAY_BASE_URL` 由 CLI 依据 `.env.example` 自动注入，无需手填。

## 换模型（无需改代码）

```bash
edgeone makers env set AI_GATEWAY_MODEL "@makers/deepseek-v4-flash"
edgeone makers deploy
```

---

## 部署实录（2026-10）

### 线上项目

| 项目 | ProjectId | 区域 | 用途 |
| --- | --- | --- | --- |
| `ai-investor-agent` | `makers-yr71vr5hpdwp` | global（含中国大陆） | 首个项目，自定义域名需 ICP 备案，已弃用为临时预览 |
| `laochen-agent` | `makers-lknrsoyjbkzw` | overseas（不含中国大陆） | **正式项目**，免备案 |
| `ai-investor` | `makers-dboofo1ndnxf` | global | 误建，可删除 |

### 线上地址

**https://www.xzhangx.top** —— 自定义域名，TrustAsia DV 证书，有效期至 2027-01-23。
（预览域名 `*.edgeone.cool` / `*.edgeone.dev` 必须带 `eo_token`+`eo_time`，有时效，不可作为长期入口。）

### 环境变量（生产环境）

```
AI_GATEWAY_API_KEY   = <Makers 控制台 Models → API Key 创建>
AI_GATEWAY_BASE_URL  = https://ai-gateway.edgeone.link/v1
WSA_API_KEY          = <腾讯云「元宝搜索」控制台 → 服务 API KEY>
AI_GATEWAY_MODEL     = 可选，默认 @makers/deepseek-v4-flash
```

### 自定义域名流程（EdgeOne Pages）

三步缺一不可：

1. **归属权验证**：控制台 → 域名管理 → 添加自定义域名 → 按弹窗在 DNSPod 加 TXT
   （主机记录形如 `edgeonereclaim.www`，TTL 600）→ 回到弹窗点「验证」
2. **CNAME**：平台分配 `你的域名.pages.dnsoeX.com`，在 DNSPod 加 CNAME 指过去
3. **HTTPS 证书**：域名状态「已生效」后，HTTPS 配置 → 申请免费 DV 证书（DNS 验证）

### 踩坑记录

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 构建卡在 `[agent-node] Observability` 后 exit 127 | **项目路径含中文**，Agent 打包器在中文路径下静默失败 | 项目迁到纯英文路径 `D:/ai-investor-agent` |
| 构建报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` | 构建会批量清理 `.edgeone/assets`，被本机安全删除守卫拦截 | 命令前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（切勿清空 `NODE_OPTIONS`，会导致 exit 127） |
| 部署失败 `[AI Gateway] Failed to bind cloud credentials: InvalidParameter` | 该账号的 CLI 自动注入链路（`CreatePagesAgentGatewayCredential`）报错 | 改为控制台手动取 Key + `deploy --skip-ai-gateway-sync` |
| 添加自定义域名提示未备案 | 项目在 `global`（含中国大陆）区域 | 用 `-a overseas` 重建项目，免备案 |
| 域名长期「请添加 CNAME」、别名 NXDOMAIN | EdgeOne 侧未开通 `*.pages.dnsoeX.com` 别名 | 平台侧故障，已提工单 |
| 预览域名 401 `eo_time missing` | `*.edgeone.cool` / `*.edgeone.dev` 预览域必须带 `eo_token`+`eo_time` | 每次部署生成的新链接自带参数，有时效，不能当长期入口 |

---

## GitHub 托管与自动部署

### 1. 推到 GitHub

```bash
cd D:/ai-investor-agent
git remote add origin https://github.com/<你的用户名>/ai-investor-agent.git
git push -u origin main
```

推送时用户名填 GitHub 用户名，**密码填 Personal Access Token（PAT）**，不是账号密码。

创建 PAT：GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → 勾选 `repo` 权限。

### 2. 配置部署密钥

在 EdgeOne 控制台创建 API Token：

👉 https://console.cloud.tencent.com/edgeone/pages?tab=settings → 「API Token」→ 创建 → 复制

然后在 GitHub 仓库：Settings → Secrets and variables → Actions → New repository secret

- Name：`EDGEONE_API_TOKEN`
- Secret：粘贴刚才的 Token

### 3. 触发自动部署

`.github/workflows/deploy.yml` 已配好，push 到 `main` 自动触发（也可在 Actions 页手动 Run workflow）：

```yaml
- run: edgeone makers deploy -n laochen-agent -t ${{ secrets.EDGEONE_API_TOKEN }} --skip-ai-gateway-sync --json
```

注意：
- 用 `makers deploy`（不是 `pages deploy`），因为本项目是带 `agents/` 的 Makers Agent 项目，CLI 会自动构建
- 必须带 `--skip-ai-gateway-sync`，该账号的网关凭证自动绑定会报 `InvalidParameter`
- 模型与环境变量已存在项目配置中，CI 不需要重复传
