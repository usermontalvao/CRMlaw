import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPEDIENTE_PADRAO_ESCRITORIO, FUSO_PADRAO_ESCRITORIO, criarPortaoDeExpediente } from './wa-channel-hours.ts';

// Banco de mentira: devolve o que o teste mandar, e conta as consultas.
function fakeAdmin(porCanal: Record<string, { timezone?: string; rows?: any[] }>) {
  let consultas = 0;
  return {
    consultas: () => consultas,
    from(tabela: string) {
      return {
        select() { return this; },
        eq(_col: string, valor: string) { (this as any).valor = valor; return this; },
        maybeSingle() {
          consultas++;
          const cfg = porCanal[(this as any).valor] || {};
          return Promise.resolve({ data: tabela === 'whatsapp_instances' ? { timezone: cfg.timezone ?? null } : null });
        },
        then(resolve: any) {
          consultas++;
          const cfg = porCanal[(this as any).valor] || {};
          return Promise.resolve(resolve({ data: tabela === 'whatsapp_business_hours' ? (cfg.rows ?? []) : [] }));
        },
      };
    },
  };
}

const seg10h = new Date('2026-08-24T14:00:00Z'); // 10h em Cuiabá (UTC-4)
const seg22h = new Date('2026-08-25T02:00:00Z'); // 22h de segunda em Cuiabá
const sab10h = new Date('2026-08-22T14:00:00Z');

test('o expediente padrão é o que estava cravado nas três varreduras', () => {
  assert.equal(FUSO_PADRAO_ESCRITORIO, 'America/Cuiaba');
  assert.equal(EXPEDIENTE_PADRAO_ESCRITORIO.length, 5);
  assert.deepEqual(EXPEDIENTE_PADRAO_ESCRITORIO[0], { day_of_week: 1, start_time: '08:00', end_time: '18:00', is_active: true });
});

test('canal 8h–18h: fala às 10h de segunda, cala às 22h e no sábado', async () => {
  const admin = fakeAdmin({ comercial: { timezone: 'America/Cuiaba', rows: EXPEDIENTE_PADRAO_ESCRITORIO } });
  const portao = criarPortaoDeExpediente(admin);
  assert.equal(await portao('comercial', seg10h), true);
  assert.equal(await portao('comercial', seg22h), false);
  assert.equal(await portao('comercial', sab10h), false);
});

test('canal 24h fala às 22h e no sábado — era isto que a constante impedia', async () => {
  const plantao = [0, 1, 2, 3, 4, 5, 6].map(day_of_week => ({ day_of_week, start_time: '00:00', end_time: '24:00', is_active: true }));
  const portao = criarPortaoDeExpediente(fakeAdmin({ plantao: { timezone: 'America/Cuiaba', rows: plantao } }));
  assert.equal(await portao('plantao', seg22h), true);
  assert.equal(await portao('plantao', sab10h), true);
});

test('canal sem agenda NÃO vira "sempre aberto": cai no horário do escritório', async () => {
  const portao = criarPortaoDeExpediente(fakeAdmin({ novo: { timezone: null as any, rows: [] } }));
  assert.equal(await portao('novo', seg10h), true);
  assert.equal(await portao('novo', seg22h), false);
});

test('sem canal (conversa órfã) também cai no horário do escritório, sem ir ao banco', async () => {
  const admin = fakeAdmin({});
  const portao = criarPortaoDeExpediente(admin);
  assert.equal(await portao(null, seg22h), false);
  assert.equal(await portao(null, seg10h), true);
  assert.equal(admin.consultas(), 0);
});

test('o cache pergunta ao banco uma vez por canal, não uma por cobrança', async () => {
  const admin = fakeAdmin({ comercial: { timezone: 'America/Cuiaba', rows: EXPEDIENTE_PADRAO_ESCRITORIO } });
  const portao = criarPortaoDeExpediente(admin);
  for (let i = 0; i < 10; i++) await portao('comercial', seg10h);
  assert.equal(admin.consultas(), 2); // canal + agenda, uma vez só
});
