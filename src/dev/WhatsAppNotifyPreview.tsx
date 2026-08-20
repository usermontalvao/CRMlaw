// DEV-ONLY: bancada das notificações de mensagem nova (?wanotifypreview=1).
//
// Serve para duas conferências que só dá para fazer com o ouvido e com o olho:
// 1) os três toques são distinguíveis entre si sem olhar a tela?
// 2) a pilha de cartões se comporta (empilha, substitui a mesma conversa,
//    some sozinha, some ao clicar)?
//
// Dispara os MESMOS eventos que o notificador global dispara em produção, então
// o que aparece aqui é literalmente o que aparece no CRM.
//
// Desde que o WhatsApp passou a avisar de outras coisas além de mensagem, a
// bancada ganhou a segunda metade: as ESPÉCIES de aviso (transferência, falha)
// e os toques que as separam. É aqui que se confere a pergunta que só o ouvido
// responde — dá para saber o que aconteceu sem olhar para a tela?
import React, { useEffect, useRef } from 'react';
import { ArrowRightLeft, Bell, MessageSquare, PhoneMissed, Volume2 } from 'lucide-react';
import { WhatsAppNotifyHost } from '../components/whatsapp/WhatsAppNotifyHost';
import { playNotificationSound, type NotifyTone } from '../utils/notificationSound';
import { events, SYSTEM_EVENTS } from '../utils/events';
import type { NotifyTier } from '../services/whatsapp/notifyScope';

// Nomes longos de propósito: é o caso real (o cartão mostra o nome do CADASTRO,
// não o apelido do WhatsApp) e é onde o layout quebra se a largura estiver curta.
const CONTATOS = [
  { id: 'conv-1', name: 'Pedro Rodrigues Montalvão Neto', preview: '', kind: 'audio' as const },
  { id: 'conv-2', name: 'Michele da Cunha Leite', preview: 'Doutor, consegui separar os documentos que o senhor pediu ontem à tarde', kind: 'image' as const },
  { id: 'conv-3', name: 'Jeanderson Santana da Silva', preview: '', kind: 'document' as const, fileName: 'comprovante-rpv.pdf' },
];

const CAMADAS: Array<{ tier: NotifyTier | 'in-chat'; titulo: string; quando: string; cartao: boolean }> = [
  { tier: 'global', titulo: 'CRM geral', quando: 'Você está em outra tela (ou a aba está escondida)', cartao: true },
  { tier: 'inbox', titulo: 'Outra conversa', quando: 'Você está no WhatsApp, a mensagem é de outra conversa', cartao: true },
  { tier: 'in-chat', titulo: 'Conversa aberta', quando: 'A mensagem chega na conversa que está na sua frente', cartao: false },
];

/** As duas espécies que não nascem de uma mensagem. */
const ESPECIES = [
  {
    id: 'transfer-aceite',
    titulo: 'Conversa transferida para você',
    quando: 'Um colega passou o caso e ela espera o seu aceite',
    tom: 'task' as NotifyTone,
    icone: ArrowRightLeft,
    disparo: {
      conversationId: 'conv-transfer',
      name: 'Maria Aparecida Lopes',
      variant: 'transfer' as const,
      byName: 'Camila Ferreira',
      note: 'é sobre o INSS dela, já expliquei a parte do agendamento',
      awaitingAccept: true,
    },
  },
  {
    id: 'transfer-fila',
    titulo: 'Distribuída da fila',
    quando: 'Entrou valendo no seu nome, sem aceite',
    tom: 'task' as NotifyTone,
    icone: ArrowRightLeft,
    disparo: {
      conversationId: 'conv-fila',
      name: 'Antônio Carlos Ribeiro',
      variant: 'transfer' as const,
      byName: null,
      note: null,
      awaitingAccept: false,
    },
  },
];

/**
 * `?wanotifypreview=1&auto=transfer-aceite` já sobe com o cartão na tela.
 *
 * Existe para a captura: o cartão só nasce de um clique, e navegador headless
 * (que é como o print chega a quem decide) não clica. Sem isto a bancada só
 * produzia prints de si mesma, com a tela vazia onde o cartão deveria estar.
 */
function useDisparoAutomatico(disparar: (id: string) => void): void {
  useEffect(() => {
    const alvo = new URLSearchParams(window.location.search).get('auto');
    if (!alvo) return;

    // `auto=todos` toca a demonstração inteira, um aviso de cada vez. É o modo
    // de MOSTRAR: abrir um link e ver (e ouvir) as quatro espécies em sequência,
    // sem precisar clicar em nada. O intervalo é de 3,5s — tempo de o toque
    // anterior morrer e de os olhos irem ao cartão antes do próximo.
    const roteiro = alvo === 'todos'
      ? ['mensagem', 'transfer-aceite', 'transfer-fila', 'falha']
      : [alvo];

    // Um quadro de atraso no primeiro: o host precisa estar montado para ouvir.
    const timers = roteiro.map((id, i) => window.setTimeout(() => disparar(id), 120 + i * 3500));
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [disparar]);
}

export default function WhatsAppNotifyPreview() {
  // Contador em ref: a rajada agenda várias chamadas de uma vez, e com state
  // todas leriam o mesmo valor — cairiam no mesmo contato e uma substituiria a
  // outra, escondendo justamente o empilhamento que se quer ver.
  const proximo = useRef(0);

  const disparar = (tier: NotifyTier | 'in-chat', cartao: boolean) => {
    const alvo = CONTATOS[proximo.current % CONTATOS.length];
    proximo.current += 1;
    playNotificationSound(tier as NotifyTone);
    if (cartao) {
      events.emit(SYSTEM_EVENTS.WHATSAPP_NOTIFY, {
        conversationId: alvo.id, name: alvo.name, preview: alvo.preview, tier,
        kind: alvo.kind, fileName: 'fileName' in alvo ? alvo.fileName : null, at: Date.now(),
      });
    }
  };

  const dispararEspecie = React.useCallback((id: string) => {
    const especie = ESPECIES.find(e => e.id === id);
    if (!especie) return;
    playNotificationSound(especie.tom);
    events.emit(SYSTEM_EVENTS.WHATSAPP_NOTIFY, {
      ...especie.disparo, preview: '', tier: 'global', kind: 'text', at: Date.now(),
    });
  }, []);

  // `auto=mensagem` cobre o cartão de sempre — a captura serve tanto para
  // aprovar o desenho novo quanto para flagrar regressão no antigo.
  useDisparoAutomatico(React.useCallback((id: string) => {
    if (id === 'mensagem') { disparar('global', true); return; }
    // A falha é só o toque: quem desenha o cartão dela é a chamada perdida (que
    // tem store próprio) ou a faixa do canal fora do ar, que ainda é mockup.
    if (id === 'falha') { playNotificationSound('alert'); return; }
    dispararEspecie(id);
  }, [dispararEspecie]));

  return (
    <main className="min-h-screen bg-[#f5f5f3] p-8">
      {/* Faixa imitando o cabeçalho do CRM: o cartão nasce logo abaixo dele. */}
      <div className="fixed inset-x-0 top-0 h-[62px] border-b border-[#e7e5df] bg-[#f8f7f5]" />

      <section className="mx-auto mt-16 w-full max-w-2xl rounded-2xl border border-[#e7e5df] bg-white p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Bell size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800">Avisos de mensagem nova</h1>
            <p className="text-xs text-slate-500">
              Três camadas: o toque muda conforme onde você está quando a mensagem chega.
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {CAMADAS.map(camada => (
            <button
              key={camada.tier}
              type="button"
              onClick={() => disparar(camada.tier, camada.cartao)}
              className="flex w-full items-center gap-3 rounded-xl border border-[#e7e5df] bg-[#faf9f7] px-4 py-3 text-left transition hover:border-amber-300 hover:bg-amber-50"
            >
              <Volume2 size={16} className="shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-slate-800">{camada.titulo}</span>
                <span className="block text-[11.5px] text-slate-500">{camada.quando}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                camada.cartao ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {camada.cartao ? 'TOQUE + CARTÃO' : 'SÓ O TOQUE'}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[.12em] text-slate-400">
            Avisos que não são mensagem
          </span>
          <span className="h-px flex-1 bg-[#e7e5df]" />
        </div>

        <div className="space-y-2.5">
          {ESPECIES.map(especie => (
            <button
              key={especie.id}
              type="button"
              onClick={() => dispararEspecie(especie.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-[#e7e5df] bg-[#faf9f7] px-4 py-3 text-left transition hover:border-orange-300 hover:bg-orange-50"
            >
              <especie.icone size={16} className="shrink-0 text-orange-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-slate-800">{especie.titulo}</span>
                <span className="block text-[11.5px] text-slate-500">{especie.quando}</span>
              </span>
              <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10.5px] font-bold text-orange-700">
                TOQUE DE TAREFA
              </span>
            </button>
          ))}

          <button
            type="button"
            onClick={() => playNotificationSound('alert')}
            className="flex w-full items-center gap-3 rounded-xl border border-[#e7e5df] bg-[#faf9f7] px-4 py-3 text-left transition hover:border-rose-300 hover:bg-rose-50"
          >
            <PhoneMissed size={16} className="shrink-0 text-rose-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-slate-800">Alguma coisa não deu certo</span>
              <span className="block text-[11.5px] text-slate-500">
                Chamada perdida, canal fora do ar, agendada que falhou — duas notas descendo
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-bold text-rose-700">
              SÓ O TOQUE
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => { for (let i = 0; i < 4; i++) window.setTimeout(() => disparar('inbox', true), i * 260); }}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-700"
        >
          <MessageSquare size={15} />
          Rajada de 4 mensagens (a pilha mostra no máximo 3)
        </button>

        <p className="mt-4 text-[11.5px] leading-relaxed text-slate-400">
          O cartão de mensagem some sozinho em 8s (fade), ou ao clicar. Mensagem repetida da mesma
          conversa substitui o cartão anterior e vira "N novas" em vez de empilhar mais um. O cartão
          de transferência fica 20s: ele não é recado, é trabalho que passou a ser seu — e some sem
          ninguém ver era exatamente o problema.
        </p>
      </section>

      <WhatsAppNotifyHost onOpen={id => window.alert(`Abriria a conversa ${id} no módulo WhatsApp.`)} />
    </main>
  );
}
