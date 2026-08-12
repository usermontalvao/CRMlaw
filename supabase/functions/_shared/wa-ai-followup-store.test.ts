import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelWaAiPendingFollowups,
  ensureWaAiFollowupScheduled,
} from './wa-ai-followup-store.ts';
import {
  WA_AI_FOLLOWUP_DEFAULTS,
  normalizeWaAiFollowupPolicy,
  type WaAiFollowupPolicy,
} from './wa-ai-followup.ts';

/**
 * A política real da campanha "Sem registro na carteira" — a que estava ligada
 * na conversa que não agendou nada em 12/08/2026.
 */
const CAMPANHA: WaAiFollowupPolicy = normalizeWaAiFollowupPolicy({
  ...WA_AI_FOLLOWUP_DEFAULTS,
  enabled: true,
  strategy: 'custom',
  customHours: [2, 4, 8, 24, 48, 168, 240, 336],
  maxAttempts: 8,
  inactivityMinutes: 10,
  days: [1, 2, 3, 4, 5],
  startMinute: 8 * 60,
  endMinute: 18 * 60,
  timezone: 'America/Cuiaba',
});

const CONVERSA = '358ea6b3-276e-4faf-8ef5-4f7c39856426';
const AGENTE = '509cc5cf-25eb-4fca-ae5a-05f7ec07e69b';

interface FollowupRow {
  id: string;
  conversation_id: string;
  assistant_id: string | null;
  attempt: number;
  scheduled_at: string;
  message: string;
  reason: string | null;
  status: string;
  cancel_reason: string | null;
}

/**
 * Um Postgres de mentira com a única regra que importa aqui: o índice único
 * `uniq_wa_ai_followup_pending`. É ele que decide as corridas de verdade, então
 * é ele que precisa estar no teste.
 */
function fakeDb(opts: { followups?: Partial<FollowupRow>[]; session?: Record<string, unknown> } = {}) {
  const db = {
    followups: (opts.followups || []).map((f, i) => ({
      id: f.id || `fu-${i}`,
      conversation_id: f.conversation_id || CONVERSA,
      assistant_id: f.assistant_id ?? AGENTE,
      attempt: f.attempt ?? 1,
      scheduled_at: f.scheduled_at || '2026-08-12T17:29:28.000Z',
      message: f.message || 'Retomada.',
      reason: f.reason ?? null,
      status: f.status || 'pending',
      cancel_reason: f.cancel_reason ?? null,
    })) as FollowupRow[],
    session: { conversation_id: CONVERSA, ...(opts.session || {}) } as Record<string, unknown>,
    seq: 100,
    /** Roda logo antes do insert: é assim que se encena a corrida. */
    beforeInsert: null as null | (() => void),
  };

  /**
   * O construtor de consulta do PostgREST, no mínimo que este módulo usa:
   * encadeia filtros e só resolve quando alguém aguarda (`maybeSingle` ou
   * `await`). Função, não classe: o `node --test` roda em strip-only e não
   * aceita propriedade de parâmetro.
   */
  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any = null;
    let single = false;
    const filters: [string, unknown][] = [];

    const matches = (row: any) => filters.every(([col, val]) => row[col] === val);

    async function run(): Promise<{ data: any; error: any }> {
      if (table === 'whatsapp_ai_sessions') {
        if (op === 'update' && matches(db.session)) Object.assign(db.session, payload);
        return { data: null, error: null };
      }

      if (op === 'select') {
        const found = db.followups.filter(matches);
        return { data: single ? (found[0] ?? null) : found, error: null };
      }

      if (op === 'update') {
        const found = db.followups.filter(matches);
        for (const row of found) Object.assign(row, payload);
        return { data: found.map(r => ({ id: r.id })), error: null };
      }

      db.beforeInsert?.();
      const row: FollowupRow = {
        id: `fu-${db.seq++}`,
        conversation_id: payload.conversation_id,
        assistant_id: payload.assistant_id ?? null,
        attempt: payload.attempt,
        scheduled_at: payload.scheduled_at,
        message: payload.message,
        reason: payload.reason ?? null,
        status: 'pending',
        cancel_reason: null,
      };
      // A única regra do banco que importa aqui: uniq_wa_ai_followup_pending.
      const conflito = db.followups.some(
        r => r.conversation_id === row.conversation_id && r.status === 'pending');
      if (conflito) {
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint "uniq_wa_ai_followup_pending"' },
        };
      }
      if (!row.message || row.message.length > 1200) {
        return { data: null, error: { code: '23514', message: 'violates check constraint' } };
      }
      db.followups.push(row);
      return { data: { id: row.id }, error: null };
    }

    const chain: any = {
      select() { return chain; },
      insert(row: any) { op = 'insert'; payload = row; return chain; },
      update(patch: any) { op = 'update'; payload = patch; return chain; },
      eq(column: string, value: unknown) { filters.push([column, value]); return chain; },
      maybeSingle() { single = true; return run(); },
      then(resolve: any, reject?: any) { return run().then(resolve, reject); },
    };
    return chain;
  }

  return { db, admin: { from: (table: string) => builder(table) } };
}

const pendentes = (db: { followups: FollowupRow[] }) => db.followups.filter(f => f.status === 'pending');

const ENTRADA = {
  conversationId: CONVERSA,
  assistantId: AGENTE,
  policy: CAMPANHA,
  attempt: 1,
  // Quarta-feira, 11:29 em Cuiabá — o horário exato da pergunta que ficou sem
  // resposta na conversa que motivou este conserto.
  fromIso: '2026-08-12T15:29:28.000Z',
  message: 'Oi, Pedro! Podemos continuar? Ficou faltando o mês e o ano da saída.',
  reason: 'Retomada automática · tentativa 1 de 8.',
};

// ── 1. A resposta normal da IA passa a criar o pendente ──────────────────────

test('a resposta da IA cria o primeiro pendente e casa com a sessão', async () => {
  const { db, admin } = fakeDb();

  const r = await ensureWaAiFollowupScheduled(admin, ENTRADA);

  assert.equal(r.created, true);
  assert.equal(pendentes(db).length, 1);
  const linha = pendentes(db)[0];
  assert.equal(linha.attempt, 1);
  assert.equal(linha.assistant_id, AGENTE);
  assert.equal(linha.message, ENTRADA.message);
  // A invariante: a sessão promete exatamente o que a linha pendente marca.
  assert.equal(db.session.next_followup_at, linha.scheduled_at);
  assert.equal(r.created && r.scheduledAt, linha.scheduled_at);
});

// ── 2. O primeiro degrau da escada desta campanha é 2h ───────────────────────

test('a primeira retomada é 10min de silêncio + o degrau de 2h', async () => {
  const { db, admin } = fakeDb();

  await ensureWaAiFollowupScheduled(admin, ENTRADA);

  // 11:29 em Cuiabá + 10min (o silêncio que define a inatividade) + 2h = 13:39.
  // Os 10 minutos não são uma tentativa: são o marco zero da escada.
  assert.equal(pendentes(db)[0].scheduled_at, '2026-08-12T17:39:00.000Z');
});

// ── 3. Fora da janela, empurra para a próxima abertura ───────────────────────

test('a retomada que cairia fora do expediente vai para a abertura seguinte', async () => {
  const { db, admin } = fakeDb();

  // Quarta, 17:30 em Cuiabá. +2h = 19:30, depois das 18:00.
  await ensureWaAiFollowupScheduled(admin, { ...ENTRADA, fromIso: '2026-08-12T21:30:00.000Z' });

  // Quinta-feira, 08:00 em Cuiabá = 12:00Z.
  assert.equal(pendentes(db)[0].scheduled_at, '2026-08-13T12:00:00.000Z');
});

test('a retomada que cairia no sábado espera a segunda-feira', async () => {
  const { db, admin } = fakeDb();

  // Sexta, 17:00 em Cuiabá (2026-08-14). +8h cai no sábado de madrugada.
  await ensureWaAiFollowupScheduled(admin, {
    ...ENTRADA, attempt: 3, fromIso: '2026-08-14T21:00:00.000Z',
  });

  assert.equal(pendentes(db)[0].scheduled_at, '2026-08-17T12:00:00.000Z');
});

// ── 4 e 5. Nunca dois pendentes ──────────────────────────────────────────────

test('pendente já existente não vira um segundo', async () => {
  const { db, admin } = fakeDb({
    followups: [{ attempt: 1, scheduled_at: '2026-08-12T17:00:00.000Z' }],
    session: { next_followup_at: null },
  });

  const r = await ensureWaAiFollowupScheduled(admin, ENTRADA);

  assert.equal(r.created, false);
  assert.equal(pendentes(db).length, 1);
  assert.equal(pendentes(db)[0].scheduled_at, '2026-08-12T17:00:00.000Z');
  // E aproveita para consertar a sessão que estava desencontrada.
  assert.equal(db.session.next_followup_at, '2026-08-12T17:00:00.000Z');
});

test('o agendamento do modelo e o do backend não se somam', async () => {
  const { db, admin } = fakeDb();

  // 1º: a ação `agendar_followup` que o modelo chamou, com o texto dele.
  const doModelo = await ensureWaAiFollowupScheduled(admin, {
    ...ENTRADA, message: 'Pedro, ficou faltando me dizer o mês e o ano da saída.',
  });
  // 2º: a garantia do fim do turno, que não sabe da primeira.
  const doBackend = await ensureWaAiFollowupScheduled(admin, ENTRADA);

  assert.equal(doModelo.created, true);
  assert.equal(doBackend.created, false);
  assert.equal(pendentes(db).length, 1);
  // O texto que fica é o do modelo: ele leu a conversa.
  assert.equal(pendentes(db)[0].message, 'Pedro, ficou faltando me dizer o mês e o ano da saída.');
});

// ── 6. A resposta do cliente desarma tudo ────────────────────────────────────

test('a resposta do cliente cancela o pendente e limpa next_followup_at', async () => {
  const { db, admin } = fakeDb({
    followups: [{ attempt: 1, scheduled_at: '2026-08-12T17:29:28.000Z' }],
    session: { next_followup_at: '2026-08-12T17:29:28.000Z' },
  });

  const cancelados = await cancelWaAiPendingFollowups(admin, CONVERSA, 'Cliente respondeu.');

  assert.equal(cancelados, 1);
  assert.equal(pendentes(db).length, 0);
  assert.equal(db.followups[0].status, 'cancelled');
  assert.equal(db.followups[0].cancel_reason, 'Cliente respondeu.');
  assert.equal(db.session.next_followup_at, null);
});

test('cancelar sem nada pendente ainda assim limpa a promessa da sessão', async () => {
  // O estado exato do bug: data na sessão, nenhuma linha pendente.
  const { db, admin } = fakeDb({ session: { next_followup_at: '2026-08-12T17:29:28.000Z' } });

  const cancelados = await cancelWaAiPendingFollowups(admin, CONVERSA, 'Cliente respondeu.');

  assert.equal(cancelados, 0);
  assert.equal(db.session.next_followup_at, null);
});

// ── 10 e 11. A escada anda sozinha ───────────────────────────────────────────

test('depois da tentativa 1 nasce a tentativa 2, com o degrau de 4h', async () => {
  const { db, admin } = fakeDb({
    followups: [{ attempt: 1, status: 'sent', scheduled_at: '2026-08-12T17:29:28.000Z' }],
    session: { followup_attempts: 1, next_followup_at: null },
  });

  const r = await ensureWaAiFollowupScheduled(admin, {
    ...ENTRADA, attempt: 2, fromIso: '2026-08-12T17:29:28.000Z',
    message: 'Pedro, voltando aqui para retomarmos de onde paramos.',
  });

  assert.equal(r.created, true);
  assert.equal(pendentes(db).length, 1);
  assert.equal(pendentes(db)[0].attempt, 2);
  // 13:29 + 4h = 17:29 em Cuiabá, ainda dentro da janela (fecha às 18:00).
  assert.equal(pendentes(db)[0].scheduled_at, '2026-08-12T21:29:00.000Z');
  assert.equal(db.session.next_followup_at, '2026-08-12T21:29:00.000Z');
});

test('a escada inteira anda sozinha, uma linha pendente de cada vez', async () => {
  const { db, admin } = fakeDb({ session: { followup_attempts: 0 } });
  const vistos: number[] = [];

  for (let tentativa = 1; tentativa <= 9; tentativa++) {
    const r = await ensureWaAiFollowupScheduled(admin, {
      ...ENTRADA, attempt: tentativa, fromIso: '2026-08-12T15:29:28.000Z',
      message: `Retomada ${tentativa}.`,
    });
    if (r.created) {
      vistos.push(tentativa);
      // O envio: o agendador marca `sent` e o turno cria a próxima.
      db.followups.find(f => f.id === r.id)!.status = 'sent';
    }
    // Nunca mais de um pendente, em nenhum momento da escada.
    assert.ok(pendentes(db).length <= 1, `tentativa ${tentativa} deixou dois pendentes`);
  }

  // ── 12. A nona tentativa não existe: o teto é 8. ──
  assert.deepEqual(vistos, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(pendentes(db).length, 0);
  // ── 13. E a sessão não fica prometendo a nona. ──
  assert.equal(db.session.next_followup_at, null);
});

// ── 12 e 13. O teto para de verdade ──────────────────────────────────────────

test('passado o teto, o pendente não nasce e a sessão não promete data', async () => {
  const { db, admin } = fakeDb({
    session: { followup_attempts: 8, next_followup_at: '2026-08-30T12:00:00.000Z' },
  });

  const r = await ensureWaAiFollowupScheduled(admin, { ...ENTRADA, attempt: 9 });

  assert.equal(r.created, false);
  assert.equal(pendentes(db).length, 0);
  assert.equal(db.session.next_followup_at, null);
});

test('texto vazio não vira linha — e não deixa promessa para trás', async () => {
  const { db, admin } = fakeDb({ session: { next_followup_at: '2026-08-12T17:29:28.000Z' } });

  const r = await ensureWaAiFollowupScheduled(admin, { ...ENTRADA, message: '   ' });

  assert.equal(r.created, false);
  assert.equal(db.followups.length, 0);
  assert.equal(db.session.next_followup_at, null);
});

// ── 14. Corrida ──────────────────────────────────────────────────────────────

test('duas execuções simultâneas deixam um pendente só', async () => {
  const { db, admin } = fakeDb();

  // A outra execução insere entre a nossa consulta e o nosso insert: é
  // exatamente aí que o índice único trabalha.
  db.beforeInsert = () => {
    db.beforeInsert = null;
    db.followups.push({
      id: 'fu-concorrente',
      conversation_id: CONVERSA,
      assistant_id: AGENTE,
      attempt: 1,
      scheduled_at: '2026-08-12T17:00:00.000Z',
      message: 'Retomada da outra execução.',
      reason: null,
      status: 'pending',
      cancel_reason: null,
    });
  };

  const r = await ensureWaAiFollowupScheduled(admin, ENTRADA);

  assert.equal(r.created, false);
  // A corrida perdida não é erro operacional: o estado final é o desejado.
  assert.equal(r.created === false && r.scheduledAt, '2026-08-12T17:00:00.000Z');
  assert.equal(pendentes(db).length, 1);
  assert.equal(pendentes(db)[0].id, 'fu-concorrente');
  assert.equal(db.session.next_followup_at, '2026-08-12T17:00:00.000Z');
});

// ── Hora marcada pelo cliente ────────────────────────────────────────────────

test('a hora que o cliente marcou substitui o degrau da escada', async () => {
  const { db, admin } = fakeDb();

  const r = await ensureWaAiFollowupScheduled(admin, {
    ...ENTRADA,
    // "me chama às 14h" — 14:00 em Cuiabá = 18:00Z.
    scheduledAtOverride: '2026-08-12T18:00:00.000Z',
    message: 'Combinado, Pedro! Falo com você às 14h.',
  });

  assert.equal(r.created, true);
  // Não é 13:29 (o degrau de 2h): é a hora que a pessoa pediu.
  assert.equal(pendentes(db)[0].scheduled_at, '2026-08-12T18:00:00.000Z');
  assert.equal(db.session.next_followup_at, '2026-08-12T18:00:00.000Z');
});

test('o compromisso do cliente vale mesmo com a escada esgotada', async () => {
  const { db, admin } = fakeDb({ session: { followup_attempts: 8 } });

  const r = await ensureWaAiFollowupScheduled(admin, {
    ...ENTRADA, attempt: 9, scheduledAtOverride: '2026-08-12T18:00:00.000Z',
  });

  // Sem o override isto seria "a política não prevê a próxima tentativa".
  assert.equal(r.created, true);
  assert.equal(pendentes(db).length, 1);
});
