submission/ 交付物清单
==================================================

项目：老陈 · AI 投资人（LangGraph Agent + EdgeOne Makers）
公开地址：https://www.xzhangx.top
提交时间：2026-10-26（GitHub Actions 于当日 23:42 跑通）

--------------------------------------------------
文件说明
--------------------------------------------------

1. local-running.png  —— 本地调试页面
   · 访问地址：http://127.0.0.1:5500/
   · 内容：本地托管前端 + 真实调用 Agent 的对话结果
   · 说明：edgeone makers dev 在本机启动时卡在 langchain 观测依赖安装
           阶段并退出（已尝试换端口、关闭 AGENT_OBSERVABILITY_ENTRIES，
           均无效），故改用本地 Node 服务托管前端并联调线上 Agent。
           脚本位于 .tools/serve-local.mjs。

2. normal-result.png  —— 正常请求结果
   · 访问地址：https://www.xzhangx.top
   · 内容：提问「考试周自习室预约小程序」→ 联网核实竞品 → 结构化回答
   · 可看要点：工具状态条「已核实竞品与市场」、真实竞品与定价数据

3. follow-up-result.png —— 连续追问结果
   · 访问地址：https://www.xzhangx.top（同一会话）
   · 内容：追问「改成考研党付费自习室 + 打卡社群，月费 99」
   · 可看要点：回答明确引用上一轮结论（"比上一版好一点，但还不行"），
               证明 checkpointer 多轮记忆生效

4. actions-success.png —— GitHub Actions 部署成功
   · 仓库：https://github.com/xiaolu7177/ai-investor-agent
   · 工作流：Deploy to EdgeOne Makers（.github/workflows/deploy.yml）
   · 运行记录：run #1，状态 Success，总耗时 1m 50s
   · 部署产物：dp0yjnkusy9d（Success）
   · 流程：checkout → setup Node 22 → npm i -g edgeone → edgeone makers deploy
           通过 Repository secret EDGEONE_API_TOKEN 完成非交互部署

5. deploy-success.png —— Makers 部署成功
   · 来源：EdgeOne Makers 控制台 → 部署记录详情
   · Deployment ID：dpobnk71y7rq
   · 时间：2026-10-26 18:36:36，构建用时 37s，状态「成功」
   · 五阶段：初始化 → 克隆仓库 → 安装依赖 → 构建 → 部署

6. public-entry.txt —— 公开访问地址
   · https://www.xzhangx.top
   · 自定义域名已签发 TrustAsia DV 证书（有效期至 2027-01-23）

--------------------------------------------------
技术栈
--------------------------------------------------
· Agent：LangGraph StateGraph + checkpointer（多轮记忆）+ web_search 工具
· 模型：DeepSeek（BYOK，经 EdgeOne AI Gateway 调用，模型 ID deepseek/deepseek-chat）
· 联网搜索：腾讯云元宝搜索（WSA）SearchPro 接口
· 部署：EdgeOne Makers（海外区域，免备案）
· 前端：原生 HTML/CSS/JS，SSE 流式渲染，节流 80ms

--------------------------------------------------
验证记录（2026-10-26 实测）
--------------------------------------------------
· 首页           HTTP 200
· SSL 证书       CN=www.xzhangx.top（TrustAsia DV，至 2027-01-23）
· /chat 对话     流式事件完整：tool_call → tool_result → ai_response
                 → usage → suggest_actions → [DONE]
· 联网搜索       单轮 2-4 次检索，返回真实竞品名称与定价
· 多轮记忆       跨对话轮次保持上下文，跨部署仍然有效
