// Cobertura da política de conexão do canal privado `whatsapp:messages`: quando
// o canal PODE ser aberto, quantas vezes se insiste, e o que sobra depois.
//
// O que estes testes travam é o laço real: canal negado deixado de pé, rejuntado
// pela biblioteca a cada 10s, para sempre. Ver broadcastGate.ts.
//
// Execução: `node --test --import ts-node/esm src/services/whatsapp/broadcastGate.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criarPortaoBroadcast,
  broadcastRetryDelay,
  isStatusDeQueda,
  BROADCAST_RETRY_DELAYS,
  BROADCAST_MAX_RETRIES,
  type DependenciasPortao,
  type StatusAssinatura,
} from './broadcastGate.ts';

interface Canal {
  tipo: 'broadcast' | 'fallback';
  n: number;
}

const TOKEN = 'jwt.de.mentira.nao-usar';

/**
 * Bancada: timers e canais na mão, para o teste não depender de relógio nem de
 * rede. `avancar()` dispara o timer pendente.
 */
function montarBancada(sobrescreve: Partial<DependenciasPortao<Canal>> = {}) {
  const logs: string[] = [];
  const abertos: Canal[] = [];
  const removidos: Canal[] = [];
  /** Ordem das operações — é o que prova "setAuth antes de channel". */
  const ordem: string[] = [];
  const esperas: number[] = [];

  let proximo = 0;
  let pendente: (() => void) | null = null;
  let cancelados = 0;
  let token: string | null = TOKEN;
  /** Quando ligado, `abrirBroadcast` estoura antes de devolver o canal. */
  let estourarNoBroadcast = false;
  /** Último callback de status entregue pelo canal broadcast em pé. */
  let dispararStatus: ((s: StatusAssinatura, e?: { message?: string } | null) => void) | null = null;

  const deps: DependenciasPortao<Canal> = {
    marca: '[Jurius Realtime][WhatsApp]',
    lerToken: async () => {
      ordem.push('lerToken');
      return token;
    },
    aplicarToken: async () => {
      ordem.push('setAuth');
    },
    abrirBroadcast: (aoStatus) => {
      ordem.push('channel:broadcast');
      if (estourarNoBroadcast) throw new Error('socket recusado');
      dispararStatus = aoStatus;
      const canal: Canal = { tipo: 'broadcast', n: proximo++ };
      abertos.push(canal);
      return canal;
    },
    abrirFallback: () => {
      ordem.push('channel:fallback');
      const canal: Canal = { tipo: 'fallback', n: proximo++ };
      abertos.push(canal);
      return canal;
    },
    remover: (canal) => {
      removidos.push(canal);
    },
    agendar: (fn, ms) => {
      esperas.push(ms);
      pendente = fn;
      return { id: esperas.length };
    },
    cancelar: () => {
      cancelados += 1;
      pendente = null;
    },
    registrar: (linha) => logs.push(linha),
    avisar: (linha) => logs.push(linha),
    ...sobrescreve,
  };

  const portao = criarPortaoBroadcast(deps);

  /** Deixa as promessas internas (lerToken/aplicarToken) assentarem. */
  const assentar = () => new Promise<void>((r) => setImmediate(r));

  return {
    portao,
    logs,
    abertos,
    removidos,
    ordem,
    esperas,
    assentar,
    cancelados: () => cancelados,
    semSessao: () => {
      token = null;
    },
    comSessao: () => {
      token = TOKEN;
    },
    falharAoAbrir: (valor: boolean) => {
      estourarNoBroadcast = valor;
    },
    status: (s: StatusAssinatura, e?: { message?: string } | null) => dispararStatus?.(s, e),
    /** Roda o timer agendado, como faria o relógio. */
    avancar: async () => {
      const fn = pendente;
      pendente = null;
      fn?.();
      await assentar();
    },
    temTimerPendente: () => pendente !== null,
    broadcasts: () => abertos.filter((c) => c.tipo === 'broadcast'),
    fallbacks: () => abertos.filter((c) => c.tipo === 'fallback'),
    /** Canais abertos que nunca foram removidos — o que sobra de socket. */
    vazando: () => abertos.filter((c) => !removidos.includes(c)),
  };
}

// ── A tabela de espera ───────────────────────────────────────

test('o backoff segue a tabela e ACABA — insistir em RLS negada não convence ninguém', () => {
  assert.deepEqual(
    BROADCAST_RETRY_DELAYS.map((_, i) => broadcastRetryDelay(i)),
    [2000, 5000, 15000, 30000],
  );
  assert.equal(broadcastRetryDelay(BROADCAST_MAX_RETRIES), null);
  assert.equal(broadcastRetryDelay(99), null);
});

test('tentativa negativa não vira espera absurda', () => {
  assert.equal(broadcastRetryDelay(-3), 2000);
});

test('estados que significam canal fora', () => {
  assert.equal(isStatusDeQueda('CHANNEL_ERROR'), true);
  assert.equal(isStatusDeQueda('TIMED_OUT'), true);
  assert.equal(isStatusDeQueda('CLOSED'), true);
  assert.equal(isStatusDeQueda('SUBSCRIBED'), false);
  assert.equal(isStatusDeQueda('joining'), false);
});

// ── 1 e 2: autenticação antes da assinatura ──────────────────

test('sem sessão o canal privado NÃO é criado — era o join anon que a policy negava', async () => {
  const b = montarBancada();
  b.semSessao();
  b.portao.iniciar();
  await b.assentar();

  assert.equal(b.broadcasts().length, 0);
  assert.ok(!b.ordem.includes('channel:broadcast'));
  assert.ok(b.logs.some((l) => l.endsWith('AUTH_MISSING')));
  // Sem broadcast, quem entrega mensagem é a rede.
  assert.equal(b.fallbacks().length, 1);
});

test('o token vai para o Realtime ANTES de o canal existir', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();

  assert.deepEqual(b.ordem, ['lerToken', 'setAuth', 'channel:broadcast']);
  assert.ok(b.ordem.indexOf('setAuth') < b.ordem.indexOf('channel:broadcast'));
  assert.ok(b.logs.some((l) => l.endsWith('AUTH_READY')));
});

// ── 3: uma assinatura só ─────────────────────────────────────

test('duas inicializações não geram dois canais', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  b.portao.iniciar(); // a segunda pega a primeira ainda no await do token
  await b.assentar();
  b.portao.iniciar(); // e esta pega o canal já de pé
  await b.assentar();

  assert.equal(b.broadcasts().length, 1);
});

test('inicializar durante o backoff não fura a espera', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('CHANNEL_ERROR');
  await b.assentar();
  assert.equal(b.broadcasts().length, 1);

  b.portao.iniciar(); // remontagem do módulo no meio da espera
  await b.assentar();

  assert.equal(b.broadcasts().length, 1, 'a remontagem não pode reabrir na hora');
  assert.ok(b.temTimerPendente());
});

// ── 4 a 7: tratamento de erro e limite ───────────────────────

test('SUBSCRIBED não agenda retry nenhum', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('SUBSCRIBED');

  assert.equal(b.esperas.length, 0);
  assert.ok(!b.temTimerPendente());
  assert.ok(b.logs.some((l) => l.endsWith('SUBSCRIBED')));
});

test('CHANNEL_ERROR remove o canal na hora — é isso que desarma o rejoin da biblioteca', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  const oCanal = b.broadcasts()[0];

  b.status('CHANNEL_ERROR', { message: 'Unauthorized' });
  await b.assentar();

  assert.ok(b.removidos.includes(oCanal), 'o canal em erro não pode ficar de pé');
  assert.deepEqual(b.esperas, [2000]);
  assert.ok(b.logs.some((l) => l.includes('CHANNEL_ERROR')));
  assert.ok(b.logs.some((l) => l.includes('RETRY_SCHEDULED')));
});

test('as tentativas seguem o backoff e param no limite, sem retry infinito', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();

  // Uma falha por tentativa, até a política desistir.
  for (let i = 0; i <= BROADCAST_MAX_RETRIES; i += 1) {
    b.status('CHANNEL_ERROR', { message: 'Unauthorized' });
    await b.assentar();
    if (b.temTimerPendente()) await b.avancar();
  }

  assert.deepEqual(b.esperas, [2000, 5000, 15000, 30000], 'exatamente a tabela, uma vez cada');
  assert.ok(b.logs.some((l) => l.endsWith('RETRY_ABORTED')));
  assert.equal(
    b.broadcasts().length,
    BROADCAST_MAX_RETRIES + 1,
    'a primeira abertura mais uma por tentativa — e nada além disso',
  );
  assert.ok(!b.temTimerPendente(), 'nada pode ficar agendado depois do limite');

  // O ponto da correção inteira: mais erros não geram mais nada.
  const antes = b.broadcasts().length;
  b.status('CHANNEL_ERROR');
  await b.assentar();
  assert.equal(b.broadcasts().length, antes);
});

test('um SUBSCRIBED no meio do caminho zera o contador', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();

  b.status('CHANNEL_ERROR');
  await b.assentar();
  await b.avancar();
  b.status('SUBSCRIBED');

  b.status('CHANNEL_ERROR');
  await b.assentar();

  assert.deepEqual(b.esperas, [2000, 2000], 'volta ao início da tabela, não continua de onde parou');
});

test('o adeus do canal que nós mesmos removemos não conta como queda', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();

  b.status('CHANNEL_ERROR');
  await b.assentar();
  // `remover` faz o canal removido reportar CLOSED. Se esse adeus contasse, a
  // reconexão que o removeu provocaria a seguinte — o laço que nunca assenta.
  b.status('CLOSED');
  await b.assentar();

  assert.deepEqual(b.esperas, [2000], 'o canal aposentado não tem mais voz');
});

// ── 8: mudança de sessão ─────────────────────────────────────

test('sessão nova ressuscita o broadcast depois de o limite ter sido atingido', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  for (let i = 0; i <= BROADCAST_MAX_RETRIES; i += 1) {
    b.status('CHANNEL_ERROR');
    await b.assentar();
    if (b.temTimerPendente()) await b.avancar();
  }
  const desistiu = b.broadcasts().length;

  b.portao.aoEventoDeSessao('TOKEN_REFRESHED');
  await b.assentar();

  assert.equal(b.broadcasts().length, desistiu + 1, 'token novo merece uma chance nova');
  b.status('CHANNEL_ERROR');
  await b.assentar();
  assert.deepEqual(b.esperas.slice(-1), [2000], 'e a tabela recomeça do início');
});

test('SIGNED_IN com o canal já no ar não derruba o que funciona', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('SUBSCRIBED');

  b.portao.aoEventoDeSessao('SIGNED_IN');
  b.portao.aoEventoDeSessao('TOKEN_REFRESHED');
  await b.assentar();

  assert.equal(b.broadcasts().length, 1);
  assert.equal(b.removidos.length, 0);
});

test('INITIAL_SESSION rearma — é o evento do carregamento da página', async () => {
  // A sessão sai do localStorage DEPOIS do primeiro render. Quem tentou assinar
  // antes disso viu AUTH_MISSING; é o INITIAL_SESSION que conserta. Uma lista de
  // eventos permitidos sem ele deixaria o canal parado até a renovação seguinte
  // do token — quase uma hora de caixa de entrada só na rede de segurança.
  const b = montarBancada();
  b.semSessao();
  b.portao.iniciar();
  await b.assentar();
  assert.equal(b.broadcasts().length, 0);

  b.comSessao();
  b.portao.aoEventoDeSessao('INITIAL_SESSION');
  await b.assentar();

  assert.equal(b.broadcasts().length, 1);
});

test('qualquer evento de sessão com o canal no ar não mexe em nada', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('SUBSCRIBED');

  for (const evento of ['USER_UPDATED', 'PASSWORD_RECOVERY', 'MFA_CHALLENGE_VERIFIED']) {
    b.portao.aoEventoDeSessao(evento);
  }
  await b.assentar();

  assert.equal(b.broadcasts().length, 1);
  assert.equal(b.removidos.length, 0);
});

// ── 9 e 10: logout e desmontagem ─────────────────────────────

test('logout remove os canais e não deixa timer para trás', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('CHANNEL_ERROR'); // abre a rede e agenda uma tentativa
  await b.assentar();

  b.portao.aoEventoDeSessao('SIGNED_OUT');

  assert.equal(b.vazando().length, 0, 'nenhum socket sobra depois do logout');
  assert.ok(!b.temTimerPendente());
  assert.ok(b.logs.some((l) => l.endsWith('CLEANED_UP')));
});

test('depois do logout, o login seguinte reabre', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.portao.aoEventoDeSessao('SIGNED_OUT');

  b.portao.aoEventoDeSessao('SIGNED_IN');
  await b.assentar();

  assert.equal(b.broadcasts().length, 2);
});

test('o cleanup remove tudo e cala o portão para sempre', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('CHANNEL_ERROR');
  await b.assentar();

  b.portao.encerrar();

  assert.equal(b.vazando().length, 0);
  assert.ok(!b.temTimerPendente());

  // Nada mais o acorda: nem status atrasado, nem sessão, nem nova inicialização.
  const depois = b.abertos.length;
  b.status('CHANNEL_ERROR');
  b.portao.aoEventoDeSessao('SIGNED_IN');
  b.portao.iniciar();
  await b.assentar();
  assert.equal(b.abertos.length, depois);
});

test('encerrar durante a leitura do token não deixa canal órfão', async () => {
  let liberar: (() => void) | null = null;
  const b = montarBancada({
    lerToken: () =>
      new Promise<string | null>((resolve) => {
        liberar = () => resolve(TOKEN);
      }),
  });
  b.portao.iniciar();
  await b.assentar();

  b.portao.encerrar(); // o await ainda está pendurado
  liberar?.();
  await b.assentar();

  assert.equal(b.broadcasts().length, 0, 'o canal não pode nascer depois do cleanup');
  assert.equal(b.vazando().length, 0);
});

test('encerrar não é chamado duas vezes por engano', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();

  b.portao.encerrar();
  const removidosDepoisDoPrimeiro = b.removidos.length;
  b.portao.encerrar();

  assert.equal(b.removidos.length, removidosDepoisDoPrimeiro);
});

// ── 12: o fallback continua de pé ────────────────────────────

test('a rede de postgres_changes abre no primeiro erro e não vira pilha', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();

  for (let i = 0; i < 3; i += 1) {
    b.status('CHANNEL_ERROR');
    await b.assentar();
    await b.avancar();
  }

  assert.equal(b.fallbacks().length, 1, 'uma rede só, por mais erros que venham');
  assert.ok(!b.removidos.some((c) => c.tipo === 'fallback'), 'a rede continua entregando');
});

test('a rede sobrevive ao RETRY_ABORTED — desistir do broadcast não é ficar sem mensagem', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  for (let i = 0; i <= BROADCAST_MAX_RETRIES; i += 1) {
    b.status('CHANNEL_ERROR');
    await b.assentar();
    if (b.temTimerPendente()) await b.avancar();
  }

  assert.equal(b.fallbacks().length, 1);
  assert.equal(b.vazando().filter((c) => c.tipo === 'fallback').length, 1);
});

test('falha ao abrir o broadcast cai na rede e agenda, sem derrubar o portão', async () => {
  const b = montarBancada();
  b.falharAoAbrir(true);
  b.portao.iniciar();
  await b.assentar();

  assert.equal(b.broadcasts().length, 0);
  assert.equal(b.fallbacks().length, 1);
  assert.deepEqual(b.esperas, [2000]);

  b.falharAoAbrir(false);
  await b.avancar();
  assert.equal(b.broadcasts().length, 1, 'a tentativa seguinte encontra o socket de pé');
});

// ── 14: o que vai para o console ─────────────────────────────

test('nenhum log carrega token, telefone ou texto de mensagem', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('SUBSCRIBED');
  b.status('CHANNEL_ERROR', {
    message: 'Unauthorized: You do not have permissions to read from this Channel topic',
  });
  await b.assentar();
  b.portao.encerrar();

  const permitido =
    /^\[Jurius Realtime\]\[WhatsApp\](\[Broadcast\]|\[PostgresFallback\]) (AUTH_READY|AUTH_MISSING|SUBSCRIBED|CHANNEL_ERROR|RETRY_SCHEDULED|RETRY_ABORTED|CLEANED_UP|ABRINDO)/;
  for (const linha of b.logs) {
    assert.ok(permitido.test(linha), `log fora do formato: ${linha}`);
    assert.ok(!linha.includes(TOKEN), `token vazou no log: ${linha}`);
  }
});

test('a mensagem de erro entra cortada — payload inteiro no console arrastaria conteúdo', async () => {
  const b = montarBancada();
  b.portao.iniciar();
  await b.assentar();
  b.status('CHANNEL_ERROR', { message: 'x'.repeat(500) });
  await b.assentar();

  const linha = b.logs.find((l) => l.includes('CHANNEL_ERROR'))!;
  assert.ok(linha.length < 220, `linha longa demais: ${linha.length}`);
});
