import { ChatOpenAI } from '@langchain/openai';

/** 默认模型：平台 AI Gateway 上的 DeepSeek，可通过 AI_GATEWAY_MODEL 覆盖（无需改代码） */
const DEFAULT_MODEL = '@makers/deepseek-v4-flash';

export interface AgentEnv {
  AI_GATEWAY_API_KEY: string;
  AI_GATEWAY_BASE_URL: string;
  AI_GATEWAY_MODEL?: string;
}

/** 从 context.env 读取并校验网关变量；缺失时显式报错，绝不静默降级 */
export function getAgentEnv(contextEnv: Record<string, string | undefined> | undefined): AgentEnv {
  const source = contextEnv ?? {};
  const required = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_BASE_URL'] as const;
  const missing = required.filter((k) => !source[k]?.trim());
  if (missing.length) throw new Error(`缺少环境变量: ${missing.join(', ')}`);
  return {
    AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY!,
    AI_GATEWAY_BASE_URL: source.AI_GATEWAY_BASE_URL!,
    AI_GATEWAY_MODEL: source.AI_GATEWAY_MODEL?.trim() || undefined,
  };
}

export function resolveModelName(env: AgentEnv): string {
  return env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
}

const modelCache = new Map<string, ChatOpenAI>();

export function createModel(env: AgentEnv): ChatOpenAI {
  const modelName = resolveModelName(env);
  const cacheKey = `${modelName}:${env.AI_GATEWAY_BASE_URL}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const model = new ChatOpenAI({
    model: modelName,
    apiKey: env.AI_GATEWAY_API_KEY,
    configuration: { baseURL: env.AI_GATEWAY_BASE_URL },
    temperature: 0.7,
    timeout: 300_000,
  });
  modelCache.set(cacheKey, model);
  return model;
}
