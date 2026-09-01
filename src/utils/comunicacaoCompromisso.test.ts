import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANTECEDENCIAS_DA_COMUNICACAO,
  ANTECEDENCIA_PADRAO_MINUTOS,
  MENSAGEM_PADRAO_DA_COMUNICACAO,
  VARIAVEIS_DA_COMUNICACAO,
  momentoDoEnvio,
  montarMensagemDaComunicacao,
  motivoDeNaoEnviar,
} from './comunicacaoCompromisso.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./comunicacaoCompromisso.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/comunicacao-compromisso.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'comunicacao-compromisso.ts divergiu — copie o arquivo inteiro');
});

// ── O texto ─────────────────────────────────────────────────────────────────

test('as variáveis viram os dados do compromisso', () => {
  const texto = montarMensagemDaComunicacao(
    'Bom dia, {primeiro_nome}. Sua audiência é {data} às {hora}, na {detalhes}.',
    { primeiro_nome: 'Maria', data: '09/09/2026', hora: '14:30', detalhes: 'Vara do Trabalho' },
  );
  assert.equal(texto, 'Bom dia, Maria. Sua audiência é 09/09/2026 às 14:30, na Vara do Trabalho.');
});

test('espaço dentro da chave é tolerado — quem digita à mão põe espaço', () => {
  assert.equal(montarMensagemDaComunicacao('Oi, { primeiro_nome }', { primeiro_nome: 'Ana' }), 'Oi, Ana');
});

test('campo vazio na origem some do texto, sem deixar a chave', () => {
  assert.equal(montarMensagemDaComunicacao('Onde: {detalhes}.', { detalhes: '' }), 'Onde: .');
});

test('{local} não existe e fica literal — a Agenda não guarda endereço', () => {
  // Oferecer a variável faria a mensagem sair com "na " e nada depois. Quem
  // precisa do endereço escreve em Detalhes.
  assert.equal(montarMensagemDaComunicacao('na {local}', {}), 'na {local}');
});

test('variável desconhecida fica LITERAL, para o erro aparecer antes do envio', () => {
  // Apagar em silêncio produziria "Seu compromisso é  às " e a advogada só
  // descobriria pela reclamação do cliente.
  const texto = montarMensagemDaComunicacao('Vai ser {dia_da_semana}', { data: '09/09' });
  assert.equal(texto, 'Vai ser {dia_da_semana}');
});

test('a mensagem padrão só usa variáveis que existem', () => {
  const usadas = [...MENSAGEM_PADRAO_DA_COMUNICACAO.matchAll(/\{\s*([a-z_]+)\s*\}/gi)].map(m => m[1]);
  assert.ok(usadas.length > 0, 'a mensagem padrão deveria ter variáveis');
  for (const chave of usadas) {
    assert.ok(
      (VARIAVEIS_DA_COMUNICACAO as string[]).includes(chave),
      `{${chave}} não está no catálogo e sairia literal no WhatsApp do cliente`,
    );
  }
});

// ── A hora ──────────────────────────────────────────────────────────────────

test('o envio é o começo do compromisso menos a antecedência', () => {
  const inicio = new Date('2026-09-09T17:30:00Z');
  assert.equal(momentoDoEnvio(inicio, 60).toISOString(), '2026-09-09T16:30:00.000Z');
  assert.equal(momentoDoEnvio(inicio, 60 * 24).toISOString(), '2026-09-08T17:30:00.000Z');
});

test('as antecedências oferecidas incluem o padrão', () => {
  assert.ok(ANTECEDENCIAS_DA_COMUNICACAO.some(a => a.minutos === ANTECEDENCIA_PADRAO_MINUTOS));
});

// ── Quando NÃO enviar ───────────────────────────────────────────────────────

const base = {
  ligada: true,
  enviadaEm: null,
  clienteId: 'c1',
  mensagem: 'Bom dia',
  inicio: '2026-09-09T17:30:00Z',
  minutosAntes: 60,
};

test('na hora certa, manda', () => {
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T16:30:00Z')), null);
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T17:00:00Z')), null,
    'meia hora depois da hora ainda vale — o cron roda de hora em hora');
});

test('cedo demais espera o cron seguinte', () => {
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T15:00:00Z')), 'ainda_cedo');
});

test('compromisso que JÁ COMEÇOU não recebe mais nada', () => {
  // A trava que impede o pior caso: o cron perde a janela das 13h e às 15h
  // manda "sua audiência é às 14h" para uma audiência que já aconteceu.
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T18:00:00Z')), 'compromisso_passou');
  assert.equal(motivoDeNaoEnviar(base, new Date('2026-09-09T17:30:00Z')), 'compromisso_passou',
    'no minuto exato do início já é tarde');
});

test('desligada, já enviada, sem cliente e sem texto não saem', () => {
  const agora = new Date('2026-09-09T16:30:00Z');
  assert.equal(motivoDeNaoEnviar({ ...base, ligada: false }, agora), 'desligada');
  assert.equal(motivoDeNaoEnviar({ ...base, enviadaEm: '2026-09-08T10:00:00Z' }, agora), 'ja_enviada');
  assert.equal(motivoDeNaoEnviar({ ...base, clienteId: null }, agora), 'sem_cliente');
  assert.equal(motivoDeNaoEnviar({ ...base, mensagem: '   ' }, agora), 'sem_mensagem');
});

test('a ordem das travas: desligada ganha de tudo', () => {
  // Desligar o interruptor é o cancelamento. Ele não pode ser vencido por uma
  // trava posterior que o log explicaria de outro jeito.
  const agora = new Date('2026-09-09T16:30:00Z');
  assert.equal(
    motivoDeNaoEnviar({ ...base, ligada: false, clienteId: null, mensagem: '' }, agora),
    'desligada',
  );
});

test('sem antecedência escolhida, usa o padrão de um dia', () => {
  const semEscolha = { ...base, minutosAntes: null };
  assert.equal(motivoDeNaoEnviar(semEscolha, new Date('2026-09-08T17:30:00Z')), null);
  assert.equal(motivoDeNaoEnviar(semEscolha, new Date('2026-09-08T16:00:00Z')), 'ainda_cedo');
});

test('antecedência zero ou negativa cai no padrão, não em "manda já"', () => {
  // Zero significaria "avisar no instante do compromisso", que é inútil, e
  // negativo significaria avisar DEPOIS. Os dois viram o padrão.
  const zero = { ...base, minutosAntes: 0 };
  // Com o padrão de um dia, a janela abre em 08/09 17:30 — antes disso, espera.
  assert.equal(motivoDeNaoEnviar(zero, new Date('2026-09-08T12:00:00Z')), 'ainda_cedo');
  assert.equal(motivoDeNaoEnviar(zero, new Date('2026-09-08T17:30:00Z')), null);
  // E não é "manda já": no instante em que o zero foi salvo, ainda faltava um dia.
  assert.equal(motivoDeNaoEnviar({ ...base, minutosAntes: -60 }, new Date('2026-09-07T09:00:00Z')), 'ainda_cedo');
});

test('data de início ilegível não vira envio às cegas', () => {
  assert.equal(
    motivoDeNaoEnviar({ ...base, inicio: 'não é data' }, new Date('2026-09-09T16:30:00Z')),
    'compromisso_passou',
  );
});
