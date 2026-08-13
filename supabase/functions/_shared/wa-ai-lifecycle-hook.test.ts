import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWaAiLifecycle } from './wa-ai-lifecycle-hook.ts';

test('evento de ciclo de vida chama o agente com service role e recurso exato', async () => {
  const original = globalThis.fetch;
  let captured: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    await dispatchWaAiLifecycle({
      supabaseUrl: 'https://project.supabase.co', serviceRole: 'service-secret',
      conversationId: 'conversation-1', trigger: 'signature_completed', resourceId: 'signature-1',
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(captured?.url, 'https://project.supabase.co/functions/v1/whatsapp-ai-agent');
  assert.equal(new Headers(captured?.init?.headers).get('Authorization'), 'Bearer service-secret');
  assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
    conversation_id: 'conversation-1',
    lifecycle_trigger: 'signature_completed',
    resource_id: 'signature-1',
  });
});

test('evento incompleto não faz chamada externa', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response('{}'); }) as typeof fetch;
  try {
    await dispatchWaAiLifecycle({
      supabaseUrl: '', serviceRole: '', conversationId: '',
      trigger: 'documents_completed', resourceId: '',
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 0);
});

test('falha do agente é devolvida para o log da operação principal', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('temporariamente indisponível', { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(dispatchWaAiLifecycle({
      supabaseUrl: 'https://project.supabase.co', serviceRole: 'service-secret',
      conversationId: 'conversation-1', trigger: 'documents_completed', resourceId: 'request-1',
    }), /lifecycle 503/);
  } finally {
    globalThis.fetch = original;
  }
});
