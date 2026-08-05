// DEV-ONLY: bancada das notificações de mensagem nova (?wanotifypreview=1).
//
// Serve para duas conferências que só dá para fazer com o ouvido e com o olho:
// 1) os três toques são distinguíveis entre si sem olhar a tela?
// 2) a pilha de cartões se comporta (empilha, substitui a mesma conversa,
//    some sozinha, some ao clicar)?
//
// Dispara os MESMOS eventos que o notificador global dispara em produção, então
// o que aparece aqui é literalmente o que aparece no CRM.
import React, { useRef } from 'react';
import { Bell, MessageSquare, Volume2 } from 'lucide-react';
import { WhatsAppNotifyHost } from '../components/whatsapp/WhatsAppNotifyHost';
import { playNotificationSound, type NotifyTone } from '../utils/notificationSound';
import { events, SYSTEM_EVENTS } from '../utils/events';
import type { NotifyTier } from '../services/whatsapp/notifyScope';

const CONTATOS = [
  { id: 'conv-1', name: 'Maria Oliveira', preview: 'Doutor, consegui o documento que o senhor pediu' },
  { id: 'conv-2', name: 'João Batista', preview: '📷 Imagem' },
  { id: 'conv-3', name: 'Cartório 2º Ofício', preview: 'Seguem as certidões solicitadas ontem' },
];

const CAMADAS: Array<{ tier: NotifyTier | 'in-chat'; titulo: string; quando: string; cartao: boolean }> = [
  { tier: 'global', titulo: 'CRM geral', quando: 'Você está em outra tela (ou a aba está escondida)', cartao: true },
  { tier: 'inbox', titulo: 'Outra conversa', quando: 'Você está no WhatsApp, a mensagem é de outra conversa', cartao: true },
  { tier: 'in-chat', titulo: 'Conversa aberta', quando: 'A mensagem chega na conversa que está na sua frente', cartao: false },
];

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
      });
    }
  };

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

        <button
          type="button"
          onClick={() => { for (let i = 0; i < 4; i++) window.setTimeout(() => disparar('inbox', true), i * 260); }}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-700"
        >
          <MessageSquare size={15} />
          Rajada de 4 mensagens (a pilha mostra no máximo 3)
        </button>

        <p className="mt-4 text-[11.5px] leading-relaxed text-slate-400">
          O cartão some sozinho em 5,5s, ou ao clicar. Mensagem repetida da mesma conversa substitui
          o cartão anterior em vez de empilhar mais um.
        </p>
      </section>

      <WhatsAppNotifyHost onOpen={id => window.alert(`Abriria a conversa ${id} no módulo WhatsApp.`)} />
    </main>
  );
}
