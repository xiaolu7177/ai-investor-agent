import { createLogger, createSSEResponse, sseEvent, jsonError } from '../_shared';
import { createModel, getAgentEnv } from '../_model';
import { buildGraph, MAX_TOOL_TURNS } from './_graph';

const log = createLogger('chat');

/**
 * DeepSeek 系列偶尔会把工具调用标记当普通文本吐出来（DSML）。
 * 逐块过滤：完整 `<|...|>` 块直接删掉；不完整的尾部先扣住，等下一块补齐。
 */
function stripDsml(buffer: string, flush = false): { out: string; rest: string } {
  const cleaned = buffer.replace(/<\|[\s\S]*?\|>/g, '');
  if (flush) return { out: cleaned, rest: '' };
  const i = cleaned.lastIndexOf('<|');
  if (i !== -1) return { out: cleaned.slice(0, i), rest: cleaned.slice(i) };
  return { out: cleaned, rest: '' };
}


export async function onRequest(context: any) {
  const { request, env, store } = context;
  const conversationId: string = context.conversation_id || '';
  const signal = request?.signal as AbortSignal | undefined;

  // 只认 `messages`（聊天 UI 与预览探针发送的唯一 body 形状）
  const messages = Array.isArray(request?.body?.messages) ? request.body.messages : [];
  const latest = [...messages]
    .reverse()
    .find(
      (m: any) =>
        m?.role === 'user' && typeof m?.content === 'string' && m.content.trim().length > 0,
    );

  if (!latest) return jsonError("'messages' is required");

  const userText: string = latest.content;
  const threadId = conversationId || `anon-${Date.now()}`;

  let model: any;
  let agentEnv: ReturnType<typeof getAgentEnv>;
  try {
    agentEnv = getAgentEnv(env);
    model = createModel(agentEnv);
  } catch (e) {
    log.error('env/model init failed', (e as Error).message);
    return jsonError((e as Error).message, 500);
  }

  // LangGraph 专用：必须注入 LangChain 的 tool() 工厂，拿到真正的 StructuredTool
  let tools: any[] = [];
  try {
    const { tool } = await import('@langchain/core/tools');
    tools = context?.tools?.toLangChainTools?.(tool, ['web_search']) ?? [];
  } catch (e) {
    log.error('tool init failed', (e as Error).message);
    tools = [];
  }

  const checkpointer = store?.langgraphCheckpointer;
  const lgStore = store?.langgraphStore;

  const graph = buildGraph({ model, tools, checkpointer, store: lgStore });

  async function* eventStream(sig?: AbortSignal): AsyncGenerator<string> {
    let sawToolCall = false;
    let pending = '';
    const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    try {
      const stream = await graph.stream(
        { messages: [{ role: 'user', content: userText }] },
        {
          streamMode: 'messages',
          signal: sig,
          recursionLimit: 2 * MAX_TOOL_TURNS + 3,
          configurable: { thread_id: threadId },
        },
      );

      for await (const chunk of stream as any) {
        if (sig?.aborted) break;
        const msg: any = Array.isArray(chunk) ? chunk[0] : chunk;
        if (!msg) continue;

        if (msg.tool_call_chunks?.length) {
          for (const tc of msg.tool_call_chunks) {
            if (tc?.name) {
              sawToolCall = true;
              yield sseEvent({ type: 'tool_call', name: tc.name });
            }
          }
          continue;
        }

        if (msg.type === 'tool') {
          const text = typeof msg.text === 'string' ? msg.text : '';
          yield sseEvent({
            type: 'tool_result',
            name: msg.name || 'web_search',
            content: text.slice(0, 500),
          });
          continue;
        }

        if (msg.text) {
          pending += msg.text;
          const { out, rest } = stripDsml(pending);
          pending = rest;
          if (out) yield sseEvent({ type: 'ai_response', content: out });
        }

        const um = msg.usage_metadata;
        if (um) {
          usage.input_tokens += um.input_tokens ?? 0;
          usage.output_tokens += um.output_tokens ?? 0;
          usage.total_tokens += um.total_tokens ?? 0;
        }
      }

      if (pending) {
        const { out } = stripDsml(pending, true);
        pending = '';
        if (out) yield sseEvent({ type: 'ai_response', content: out });
      }

      if (usage.total_tokens > 0) yield sseEvent({ type: 'usage', ...usage });

      if (sawToolCall) {
        yield sseEvent({ type: 'suggest_actions', actions: ['再压一轮价', '帮我改方案', '换个思路'] });
      }
    } catch (e) {
      const err = e as Error;
      if (err?.name === 'AbortError' || sig?.aborted) {
        log.log('client aborted', threadId);
      } else {
        log.error('stream failed', err?.message);
        yield sseEvent({
          type: 'error_message',
          content: `老陈卡壳了：${err?.message ?? '未知错误'}`,
        });
      }
    }
    yield 'data: [DONE]\n\n';
  }

  log.log('chat start', { threadId, tools: tools.length, model: agentEnv.AI_GATEWAY_MODEL || 'default' });
  return createSSEResponse((sig) => eventStream(sig), signal);
}
