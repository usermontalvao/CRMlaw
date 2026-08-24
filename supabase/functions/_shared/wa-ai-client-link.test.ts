import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureWaAiConversationClient,
  matchWaAiClientsByPhone,
  normalizeWaAiClientPhone,
  waAiClientPhoneVariants,
} from './wa-ai-client-link.ts';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const CREATED = '22222222-2222-4222-8222-222222222222';

function fakeDb(opts: {
  matches?: { id: string }[];
  matchError?: boolean;
  createError?: boolean;
  linkError?: boolean;
} = {}) {
  const calls: { op: string; value?: unknown }[] = [];
  const admin = {
    from(table: string) {
      if (table === 'whatsapp_conversations') {
        return {
          update(value: unknown) {
            calls.push({ op: 'conversation:update', value });
            return { async eq(_key: string, id: string) {
              calls.push({ op: 'conversation:eq', value: id });
              return { error: opts.linkError ? { message: 'falhou' } : null };
            } };
          },
        };
      }
      if (table === 'clients') {
        return {
          select(value: unknown) {
            calls.push({ op: 'clients:match:select', value });
            return {
              neq() { return this; },
              is() { return this; },
              or(value: unknown) { calls.push({ op: 'clients:match:or', value }); return this; },
              async limit() {
                return {
                  data: (opts.matches || []).map((row) => ({
                    ...row,
                    mobile: '(65) 99999-1234',
                    phone: null,
                  })),
                  error: opts.matchError ? { message: 'falhou' } : null,
                };
              },
            };
          },
          insert(value: unknown) {
            calls.push({ op: 'clients:insert', value });
            return { select() { return { async single() {
              return { data: opts.createError ? null : { id: CREATED }, error: opts.createError ? { message: 'falhou' } : null };
            } }; } };
          },
          delete() {
            calls.push({ op: 'clients:delete' });
            return { async eq(_key: string, id: string) {
              calls.push({ op: 'clients:delete:eq', value: id });
              return { error: null };
            } };
          },
        };
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };
  return { admin, calls };
}

const conversation = () => ({
  id: '33333333-3333-4333-8333-333333333333',
  client_id: null,
  contact_name: 'Pedro',
  contact_phone: '(65) 99999-1234',
});

test('normaliza telefone nacional e preserva o que já tem DDI', () => {
  assert.equal(normalizeWaAiClientPhone('(65) 99999-1234'), '5565999991234');
  assert.equal(normalizeWaAiClientPhone('+55 65 99999-1234'), '5565999991234');
  assert.equal(normalizeWaAiClientPhone('123'), null);
});

test('gera variantes brasileiras com e sem o nono dígito', () => {
  assert.deepEqual(
    waAiClientPhoneVariants('(65) 99999-1234').sort(),
    ['556599991234', '5565999991234'].sort(),
  );
});

test('busca interna filtra a formatação e não depende da RPC de funcionário', async () => {
  const { admin, calls } = fakeDb({ matches: [{ id: CLIENT }] });
  const result = await matchWaAiClientsByPhone(admin, '+55 65 99999-1234');
  assert.deepEqual(result.data.map((row) => row.id), [CLIENT]);
  assert.ok(calls.some((call) => call.op === 'clients:match:or' && call.value === 'phone.ilike.%1234%,mobile.ilike.%1234%'));
  assert.ok(!calls.some((call) => call.op.startsWith('rpc:')));
});

test('conversa já vinculada não consulta nem cria nada', async () => {
  const { admin, calls } = fakeDb();
  const conv = { ...conversation(), client_id: CLIENT };
  const result = await ensureWaAiConversationClient(admin, conv);
  assert.deepEqual(result, { ok: true, clientId: CLIENT, created: false });
  assert.deepEqual(calls, []);
});

test('telefone com um cadastro existente vincula a conversa', async () => {
  const { admin, calls } = fakeDb({ matches: [{ id: CLIENT }] });
  const conv = conversation();
  const result = await ensureWaAiConversationClient(admin, conv);
  assert.deepEqual(result, { ok: true, clientId: CLIENT, created: false });
  assert.equal(conv.client_id, CLIENT);
  assert.ok(calls.some(call => call.op === 'conversation:update'));
  assert.ok(!calls.some(call => call.op === 'clients:insert'));
});

test('lead novo ganha pré-cadastro e vínculo antes dos documentos', async () => {
  const { admin, calls } = fakeDb();
  const conv = conversation();
  const result = await ensureWaAiConversationClient(admin, conv, 'Pedro da Silva');
  assert.deepEqual(result, { ok: true, clientId: CREATED, created: true });
  assert.equal(conv.client_id, CREATED);
  const insert = calls.find(call => call.op === 'clients:insert')?.value as Record<string, unknown>;
  assert.equal(insert.full_name, 'Pedro da Silva');
  assert.equal(insert.mobile, '5565999991234');
  assert.equal(insert.is_pre_cadastro, true);
});

test('telefone ambíguo falha fechado e não escolhe cliente no chute', async () => {
  const { admin, calls } = fakeDb({ matches: [{ id: CLIENT }, { id: CREATED }] });
  const result = await ensureWaAiConversationClient(admin, conversation());
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /mais de um cadastro/);
  assert.ok(!calls.some(call => call.op === 'clients:insert'));
  assert.ok(!calls.some(call => call.op === 'conversation:update'));
});

test('falha ao vincular desfaz o pré-cadastro recém-criado', async () => {
  const { admin, calls } = fakeDb({ linkError: true });
  const result = await ensureWaAiConversationClient(admin, conversation());
  assert.equal(result.ok, false);
  assert.ok(calls.some(call => call.op === 'clients:delete'));
});
