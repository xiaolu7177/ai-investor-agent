import { jsonError } from './_shared';

/** POST /stop —— 只从 body 取 conversation_id，绝不携带 makers-conversation-id 头 */
export async function onRequest(context: any) {
  const conversationId = context?.request?.body?.conversation_id;
  if (!conversationId || typeof conversationId !== 'string') {
    return jsonError("'conversation_id' is required");
  }

  const abortActiveRun = context?.utils?.abortActiveRun;
  if (typeof abortActiveRun !== 'function') {
    return jsonError('abort is not supported in this runtime', 501);
  }

  try {
    await abortActiveRun(conversationId);
  } catch (e) {
    return jsonError((e as Error)?.message ?? 'abort failed', 500);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
