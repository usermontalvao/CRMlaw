// Cobertura do registro compartilhado: um canal por chave, muitos consumidores,
// e nada aberto sobrando. Ver sharedResource.ts.
//
// Execução: `node --test --import ts-node/esm src/services/realtime/sharedResource.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarRegistroCompartilhado } from './sharedResource.ts';

function montarBancada() {
  const aberturas: string[] = [];
  const fechamentos: string[] = [];
  const logs: string[] = [];
  const publicadores = new Map<string, (valor: string[]) => void>();

  const registro = criarRegistroCompartilhado<string[]>({
    marca: '[Jurius Realtime][Scheduled]',
    registrar: (l) => logs.push(l),
    abrir: (chave, publicar) => {
      aberturas.push(chave);
      publicadores.set(chave, publicar);
      return () => {
        fechamentos.push(chave);
        publicadores.delete(chave);
      };
    },
  });

  return {
    registro,
    aberturas,
    fechamentos,
    logs,
    /** Simula a chegada de dados do canal/consulta daquela chave. */
    chegou: (chave: string, valor: string[]) => publicadores.get(chave)?.(valor),
  };
}

// ── Um canal por chave ───────────────────────────────────────

test('dois consumidores da mesma chave abrem UM recurso', () => {
  const b = montarBancada();
  // As bolhas-fantasma da thread e o painel lateral, mesma conversa.
  b.registro.assinar('conv-1', () => {});
  b.registro.assinar('conv-1', () => {});

  assert.deepEqual(b.aberturas, ['conv-1']);
  assert.equal(b.registro.consumidores('conv-1'), 2);
  assert.ok(b.logs.some((l) => l.endsWith('REUSE')));
});

test('chaves diferentes são independentes', () => {
  const b = montarBancada();
  const sairA = b.registro.assinar('conv-1', () => {});
  b.registro.assinar('conv-2', () => {});

  assert.deepEqual(b.aberturas, ['conv-1', 'conv-2']);
  sairA();
  assert.deepEqual(b.fechamentos, ['conv-1'], 'fechar uma conversa não toca na outra');
  assert.equal(b.registro.abertos(), 1);
});

test('todos os consumidores recebem o valor', () => {
  const b = montarBancada();
  const a: string[][] = [];
  const c: string[][] = [];
  b.registro.assinar('conv-1', (v) => a.push(v));
  b.registro.assinar('conv-1', (v) => c.push(v));

  b.chegou('conv-1', ['msg-1']);

  assert.deepEqual(a, [['msg-1']]);
  assert.deepEqual(c, [['msg-1']]);
});

test('quem chega depois recebe o último valor na hora, sem nova ida ao servidor', () => {
  const b = montarBancada();
  b.registro.assinar('conv-1', () => {});
  b.chegou('conv-1', ['msg-1']);

  const atrasado: string[][] = [];
  b.registro.assinar('conv-1', (v) => atrasado.push(v));

  assert.deepEqual(atrasado, [['msg-1']]);
  assert.deepEqual(b.aberturas, ['conv-1'], 'nada foi reaberto');
});

test('EVENTO não é reentregue a quem chega depois', () => {
  // Reentregar o último evento faria uma mensagem antiga tocar o aviso de novo
  // a cada vez que alguém abrisse o chat.
  const publicadores = new Map<string, (v: string) => void>();
  const registro = criarRegistroCompartilhado<string>({
    reentregarUltimo: false,
    abrir: (chave, publicar) => { publicadores.set(chave, publicar); return () => {}; },
  });

  registro.assinar('todas', () => {});
  publicadores.get('todas')?.('msg-antiga');

  const atrasado: string[] = [];
  registro.assinar('todas', (v) => atrasado.push(v));

  assert.deepEqual(atrasado, [], 'quem chega depois não ouve o que já passou');

  // Mas continua recebendo o que vier a partir de agora.
  publicadores.get('todas')?.('msg-nova');
  assert.deepEqual(atrasado, ['msg-nova']);
});

test('ESTADO é reentregue — é o padrão, e é o caso das agendadas', () => {
  const b = montarBancada();
  b.registro.assinar('conv-1', () => {});
  b.chegou('conv-1', ['msg-1']);

  const atrasado: string[][] = [];
  b.registro.assinar('conv-1', (v) => atrasado.push(v));

  assert.deepEqual(atrasado, [['msg-1']]);
});

test('um valor publicado durante a abertura não se perde', () => {
  // `abrir` pode publicar de forma síncrona (cache quente). Se a entrada só
  // entrasse no mapa depois, esse primeiro valor cairia no vazio.
  const recebidos: string[][] = [];
  const registro = criarRegistroCompartilhado<string[]>({
    abrir: (_chave, publicar) => { publicar(['imediato']); return () => {}; },
  });
  registro.assinar('conv-1', (v) => recebidos.push(v));

  assert.deepEqual(recebidos, [['imediato']]);
});

// ── Ciclo de vida ────────────────────────────────────────────

test('o último a sair fecha; os anteriores não', () => {
  const b = montarBancada();
  const sairA = b.registro.assinar('conv-1', () => {});
  const sairB = b.registro.assinar('conv-1', () => {});

  sairA();
  assert.deepEqual(b.fechamentos, [], 'ainda há quem esteja olhando');
  sairB();
  assert.deepEqual(b.fechamentos, ['conv-1']);
  assert.equal(b.registro.abertos(), 0);
});

test('cancelar duas vezes não fecha o recurso de quem chegou depois (StrictMode)', () => {
  const b = montarBancada();
  const sairA = b.registro.assinar('conv-1', () => {});
  sairA();
  assert.deepEqual(b.fechamentos, ['conv-1']);

  // Remontagem: abre de novo.
  b.registro.assinar('conv-1', () => {});
  assert.deepEqual(b.aberturas, ['conv-1', 'conv-1']);

  // O cleanup antigo dispara outra vez e não pode derrubar o recurso novo.
  sairA();
  assert.deepEqual(b.fechamentos, ['conv-1'], 'o cancelamento é idempotente');
  assert.equal(b.registro.abertos(), 1);
});

test('montar, desmontar e montar de novo termina com UM recurso aberto', () => {
  const b = montarBancada();
  b.registro.assinar('conv-1', () => {})();
  b.registro.assinar('conv-1', () => {});

  assert.equal(b.registro.abertos(), 1);
  assert.equal(b.registro.consumidores('conv-1'), 1);
});

test('quem saiu não recebe mais nada', () => {
  const b = montarBancada();
  const recebidos: string[][] = [];
  const sair = b.registro.assinar('conv-1', (v) => recebidos.push(v));
  b.registro.assinar('conv-1', () => {}); // segura o recurso aberto

  sair();
  b.chegou('conv-1', ['msg-1']);

  assert.deepEqual(recebidos, []);
});

test('quem sai durante a própria entrega não quebra a rodada', () => {
  const b = montarBancada();
  const vistos: string[] = [];
  const sair = b.registro.assinar('conv-1', () => { vistos.push('primeiro'); sair(); });
  b.registro.assinar('conv-1', () => vistos.push('segundo'));

  b.chegou('conv-1', ['msg-1']);

  assert.deepEqual(vistos, ['primeiro', 'segundo']);
});

test('um consumidor que estoura não derruba os outros nem o recurso', () => {
  const b = montarBancada();
  let chegouNoSegundo = false;
  b.registro.assinar('conv-1', () => { throw new Error('render quebrado'); });
  b.registro.assinar('conv-1', () => { chegouNoSegundo = true; });

  b.chegou('conv-1', ['msg-1']);

  assert.ok(chegouNoSegundo);
  assert.equal(b.registro.abertos(), 1);
});

test('publicar numa chave sem ninguém não estoura nem guarda lixo', () => {
  const b = montarBancada();
  b.registro.publicar('conv-inexistente', ['x']);
  assert.equal(b.registro.abertos(), 0);
});

// ── O caso das conversas: módulo + notificador na mesma fonte ──

test('módulo e notificador dividem UM canal, e o notificador sobrevive ao módulo', () => {
  // O notificador global (sino/som) vive fora do módulo do WhatsApp. Antes cada
  // um abria o seu canal sobre `whatsapp_conversations`, sem filtro e com
  // `event: '*'` nos dois — a mesma linha de ~400 bytes chegava duas vezes.
  const b = montarBancada();
  const noNotificador: string[][] = [];
  const noModulo: string[][] = [];

  const pararNotificador = b.registro.assinar('todas', (v) => noNotificador.push(v));
  const pararModulo = b.registro.assinar('todas', (v) => noModulo.push(v));

  assert.deepEqual(b.aberturas, ['todas'], 'um canal para os dois');

  b.chegou('todas', ['conv-1']);
  assert.equal(noNotificador.length, 1);
  assert.equal(noModulo.length, 1);

  // Sair do módulo do WhatsApp não pode calar o aviso — é justamente quando o
  // aviso é a única coisa que existe.
  pararModulo();
  b.chegou('todas', ['conv-2']);

  assert.equal(noNotificador.length, 2);
  assert.equal(noModulo.length, 1);
  assert.deepEqual(b.fechamentos, [], 'o canal continua de pé para o notificador');

  pararNotificador();
  assert.deepEqual(b.fechamentos, ['todas']);
});
