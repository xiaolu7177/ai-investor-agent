import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { SYSTEM_PROMPT } from './_prompt';

/**
 * LangGraph 图：agent → (条件) → tools → agent …
 * 工具节点自己实现（不用官方 ToolNode），好处是单次工具失败不会炸掉整条流。
 */

const MAX_TOOL_TURNS = 4;

function buildToolsNode(toolMap: Map<string, any>) {
  return async function toolsNode(state: typeof MessagesAnnotation.State) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const calls = (last as any)?.tool_calls ?? [];
    const results: ToolMessage[] = [];

    for (const call of calls.slice(0, 3)) {
      const picked = toolMap.get(call.name);
      let content = '';
      try {
        if (!picked) throw new Error(`未知工具 ${call.name}`);
        const raw = await picked.invoke(call.args ?? {});
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        content = text.slice(0, 6000);
      } catch (e) {
        // 工具失败（常见原因：未配置 WSA_API_KEY）→ 交给模型自己兜底，不中断对话
        content = `工具调用失败：${(e as Error)?.message ?? '未知错误'}。请基于你的经验继续判断，并明确告知用户本次没能联网核实。`;
      }
      results.push(
        new ToolMessage({
          content,
          tool_call_id: call.id ?? `call_${results.length}`,
          name: call.name,
        }) as any,
      );
    }
    return { messages: results };
  };
}

function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
  const last = state.messages[state.messages.length - 1] as any;
  return last?.tool_calls?.length ? 'tools' : END;
}

export interface BuildGraphOptions {
  model: any;
  tools: any[];
  checkpointer?: any;
  store?: any;
}

/** 同一个 checkpointer 实例复用同一张编译后的图 */
const graphCache = new WeakMap<object, any>();

export function buildGraph({ model, tools, checkpointer, store }: BuildGraphOptions) {
  if (checkpointer && typeof checkpointer === 'object') {
    const cached = graphCache.get(checkpointer);
    if (cached) return cached;
  }

  const toolMap = new Map<string, any>(tools.map((t) => [t.name, t]));
  const modelWithTools = tools.length ? model.bindTools(tools) : model;

  async function agentNode(state: typeof MessagesAnnotation.State) {
    const messages = [ { role: 'system', content: SYSTEM_PROMPT }, ...state.messages ] as any;
    const reply = await modelWithTools.invoke(messages);
    return { messages: [reply] };
  }

  const builder = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    .addEdge(START, 'agent');

  if (tools.length) {
    builder.addNode('tools', buildToolsNode(toolMap));
    builder.addConditionalEdges('agent', shouldContinue);
    builder.addEdge('tools', 'agent');
  } else {
    builder.addEdge('agent', END);
  }

  const compiled = builder.compile({ checkpointer, store });

  if (checkpointer && typeof checkpointer === 'object') {
    graphCache.set(checkpointer, compiled);
  }
  return compiled;
}

export { MAX_TOOL_TURNS };
