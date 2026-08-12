import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WA_AI_RESET_COMMANDS,
  resetWaAiConversationState,
} from './wa-ai-reset.ts';

function fakeAdmin(errorByTable: Record<string, string> = {}) {
  const calls: Array<{ table: string; patch: Record<string, unknown>; column: string; value: string }> = [];

  return {
    calls,
    client: {
      from(table: string) {
        return {
          update(patch: Record<string, unknown>) {
            return {
              async eq(column: string, value: string) {
                calls.push({ table, patch, column, value });
                return { error: errorByTable[table] ? { message: errorByTable[table] } : null };
              },
            };
          },
        };
      },
    },
  };
}

test('reconhece somente os comandos explícitos de reinício', () => {
  assert.deepEqual([...WA_AI_RESET_COMMANDS], ['/clear', '/limpar', '/reiniciar', '/reset']);
  assert.equal(WA_AI_RESET_COMMANDS.includes('/cleae' as never), false);
});

test('o reinício libera a conversa antes de reativar e limpar a sessão', async () => {
  const admin = fakeAdmin();
  await resetWaAiConversationState(admin.client, 'conversa-1', '2026-08-12T15:10:30.000Z');

  assert.equal(admin.calls.length, 2);
  assert.deepEqual(admin.calls[0], {
    table: 'whatsapp_conversations',
    patch: {
      assigned_user_id: null,
      awaiting_accept: false,
      transfer_pending_since: null,
      status: 'open',
    },
    column: 'id',
    value: 'conversa-1',
  });
  assert.equal(admin.calls[1].table, 'whatsapp_ai_sessions');
  assert.equal(admin.calls[1].column, 'conversation_id');
  assert.equal(admin.calls[1].value, 'conversa-1');
  assert.equal(admin.calls[1].patch.ai_active, true);
  assert.equal(admin.calls[1].patch.status, 'active');
  assert.equal(admin.calls[1].patch.history_from, '2026-08-12T15:10:30.000Z');
  assert.equal(admin.calls[1].patch.last_processed_message_id, null);
});

test('não reinicia a sessão quando não conseguiu liberar a conversa', async () => {
  const admin = fakeAdmin({ whatsapp_conversations: 'sem permissão' });

  await assert.rejects(
    resetWaAiConversationState(admin.client, 'conversa-2', '2026-08-12T15:10:30.000Z'),
    /Falha ao liberar a conversa para a IA: sem permissão/,
  );
  assert.equal(admin.calls.length, 1);
  assert.equal(admin.calls[0].table, 'whatsapp_conversations');
});
