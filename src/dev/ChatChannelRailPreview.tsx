// DEV-ONLY: bancada do trilho de canais (?chatrailpreview=1).
//
// O trilho vive dentro do painel de mensagens, que vive atrás do login. Para
// conferir "99+ no WhatsApp" ou "trilho com uma conversa aberta" na vida real
// seria preciso produzir a situação — e entrar no sistema. Aqui os estados
// ficam lado a lado, dentro da moldura de verdade: mesma largura (440), mesma
// altura (590), mesmo raio, mesma sombra do painel.
//
// O fundo imita a tela do CRM (creme #f8f7f5) de propósito: é sobre ela que o
// painel branco precisa continuar sendo uma peça, e não um recorte.
import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MessageCircle, Users, ExternalLink, ChevronDown, X } from 'lucide-react';
import ChatChannelRail from '../components/chat/ChatChannelRail';
import { animacaoDoPainel } from '../components/chat/panelMotion';

type Canal = 'whatsapp' | 'equipe';

const CORES: Array<{ bg: string; fg: string }> = [
  { bg: '#e8f0fe', fg: '#1a56c4' },
  { bg: '#f3e8fd', fg: '#7627bb' },
  { bg: '#eceff1', fg: '#455a64' },
  { bg: '#fde8f1', fg: '#b4187a' },
];

const CONVERSAS = [
  { nome: 'Mariana Cerqueira Nascimento', previa: 'Oi', hora: '22:50', naoLida: true },
  { nome: 'Pedro Rodrigues e Ana Paula', previa: 'Pra fazer', hora: '13:39', naoLida: false },
  { nome: 'Geral', previa: 'Você: fechei o acordo do Breno', hora: '15:01', naoLida: false },
  { nome: 'Roberta Aguiar', previa: 'eu vou trabalhar kkk', hora: '19:17', naoLida: false },
];

const Linha: React.FC<{ i: number }> = ({ i }) => {
  const c = CONVERSAS[i];
  const cor = CORES[i % CORES.length];
  const iniciais = c.nome.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('').toUpperCase();
  return (
    <div className="mx-2 px-2.5 py-2 flex items-center gap-3 rounded-xl" style={c.naoLida ? { background: '#fffaf5' } : undefined}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0"
        style={{ background: cor.bg, color: cor.fg }}
      >
        {iniciais}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className={`text-[13.5px] truncate ${c.naoLida ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>{c.nome}</div>
          <div className={`text-[11px] shrink-0 tabular-nums ${c.naoLida ? 'text-orange-600 font-medium' : 'text-slate-400'}`}>{c.hora}</div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-[3px]">
          <div className={`text-[12.5px] truncate ${c.naoLida ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>{c.previa}</div>
          {c.naoLida && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />}
        </div>
      </div>
    </div>
  );
};


/** A moldura de verdade: 440×590, raio 24, a sombra do painel, o padding do trilho. */
const Moldura: React.FC<{
  canal: Canal;
  wa: number;
  equipe: number;
  emConversa?: boolean;
}> = ({ canal: inicial, wa, equipe, emConversa }) => {
  const [canal, setCanal] = useState<Canal>(inicial);
  return (
      <div
        className="cw-light rounded-[24px] text-slate-800 overflow-hidden flex flex-col relative"
        style={{
          width: 440,
          height: 590,
          paddingLeft: 56,
          background: '#ffffff',
          border: '1px solid rgba(15,23,42,.10)',
          boxShadow: '0 24px 56px -20px rgba(15,23,42,.28), 0 8px 20px -12px rgba(15,23,42,.16), 0 0 0 1px rgba(15,23,42,.07)',
        }}
      >
        <div className="absolute left-0 top-0 bottom-0 z-30 flex">
          <ChatChannelRail
            items={[
              { key: 'whatsapp' as const, label: 'WhatsApp', icon: MessageCircle, count: wa },
              { key: 'equipe' as const, label: 'Equipe', icon: Users, count: equipe },
            ]}
            value={canal}
            onChange={setCanal}
            onNew={canal === 'equipe' && !emConversa ? () => {} : undefined}
          />
        </div>

        <div className="relative px-3 py-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {emConversa ? (
              <>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold" style={{ background: '#fde8f1', color: '#b4187a' }}>RA</div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold tracking-tight truncate">Roberta Aguiar</div>
                  <div className="text-[11px] font-medium text-emerald-600">Ativo agora</div>
                </div>
              </>
            ) : (
              <span className="text-[14px] font-semibold tracking-tight text-slate-800 truncate">
                {canal === 'whatsapp' ? 'WhatsApp' : 'Equipe'}
              </span>
            )}
          </div>
          {/* O trio: sair para o módulo, minimizar (guarda a conversa), fechar. */}
          <div className="flex items-center gap-1 text-slate-400">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" title="Abrir em tela cheia"><ExternalLink className="w-4 h-4" /></div>
            <div className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500" title="Minimizar"><ChevronDown className="w-[18px] h-[18px]" strokeWidth={2.1} /></div>
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" title="Fechar"><X className="w-4 h-4" /></div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden py-1 flex flex-col gap-0.5">
          {canal === 'equipe' && !emConversa && CONVERSAS.map((_, i) => <Linha key={i} i={i} />)}
          {canal === 'whatsapp' && !emConversa && (
            <div className="flex-1 flex items-center justify-center text-[12.5px] text-slate-400 px-8 text-center">
              Aqui entra o módulo WhatsApp embutido — a bancada só cuida do trilho e da moldura.
            </div>
          )}
          {emConversa && (
            <div className="flex-1 flex flex-col justify-end gap-2 p-3">
              <div className="self-start max-w-[80%] px-3.5 py-2 rounded-2xl text-[13.5px] text-slate-700" style={{ background: '#f4f4f2' }}>eu vou trabalhar kkk</div>
              <div className="self-end max-w-[80%] px-3.5 py-2 rounded-2xl text-[13.5px] text-slate-800" style={{ background: '#fdeadb' }}>bom trabalho!</div>
            </div>
          )}
        </div>
      </div>
  );
};


/** Moldura com legenda em cima — o formato dos cartões da bancada. */
const Painel: React.FC<{
  titulo: string;
  nota: string;
  canal: Canal;
  wa: number;
  equipe: number;
  emConversa?: boolean;
}> = ({ titulo, nota, ...resto }) => (
  <div className="flex flex-col gap-2">
    <div className="px-1">
      <div className="text-[13px] font-semibold text-slate-800">{titulo}</div>
      <div className="text-[11.5px] text-slate-500 max-w-[440px]">{nota}</div>
    </div>
    <Moldura {...resto} />
  </div>
);

/**
 * A ABERTURA, com a mola de verdade.
 *
 * Os números vêm de `panelMotion`, o mesmo módulo que o widget usa — mexer lá
 * muda os dois. Aqui dá para bater o olho no gesto quantas vezes quiser sem
 * entrar no sistema, que é o que a abertura real exige.
 */
const Abertura: React.FC = () => {
  const semMovimento = useReducedMotion();
  const [aberto, setAberto] = useState(true);
  return (
    <div className="flex flex-col gap-2">
      <div className="px-1">
        <div className="text-[13px] font-semibold text-slate-800">A abertura</div>
        <div className="text-[11.5px] text-slate-500 max-w-[440px]">
          Clique no botão: o painel cresce do canto da barra, com mola na entrada e saída curta.
        </div>
      </div>
      <div className="relative" style={{ width: 440, height: 660 }}>
        <div className="absolute bottom-0 right-0 flex flex-col items-end">
          <AnimatePresence>
            {aberto && (
              <motion.div
                className="relative mb-3"
                style={{ transformOrigin: 'bottom right', willChange: 'transform, opacity' }}
                {...animacaoDoPainel(semMovimento)}
              >
                <Moldura canal="equipe" wa={46} equipe={2} />
              </motion.div>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={() => setAberto(a => !a)}
            className="h-11 px-4 rounded-full text-[13px] font-semibold"
            style={{
              background: aberto
                ? 'linear-gradient(180deg,#fff8f2 0%,#ffeedd 100%)'
                : 'linear-gradient(180deg,#ffffff 0%,#f8f7f5 100%)',
              border: `1px solid ${aberto ? 'rgba(242,122,35,.38)' : '#e7e5df'}`,
              color: aberto ? '#9a4a10' : '#334155',
              boxShadow: '0 1px 2px rgba(32,33,36,.12), 0 6px 16px -6px rgba(15,23,42,.22)',
            }}
          >
            {aberto ? 'Fechar' : 'Mensagens'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ChatChannelRailPreview: React.FC = () => (
  <div style={{ background: '#f8f7f5', minHeight: '100vh', padding: 28, fontFamily: "'Inter', -apple-system, sans-serif" }}>
    <h1 className="text-[17px] font-bold text-slate-900">Trilho de canais — bancada</h1>
    <p className="text-[12.5px] text-slate-500 mt-1 mb-6 max-w-[760px]">
      Os canais saíram do cabeçalho e viraram coluna. Clique nos itens: a pastilha e a barra laranja
      acompanham, o cabeçalho troca de nome, e o "+" só existe na Equipe.
    </p>
    <div className="flex flex-wrap gap-8">
      <Painel titulo="Equipe, com pendência dos dois lados" nota="O estado normal da manhã: 46 esperando no WhatsApp, 2 na equipe." canal="equipe" wa={46} equipe={2} />
      <Painel titulo="WhatsApp ativo, equipe em silêncio" nota="Sem pendência não se desenha contador nenhum — o zero é ruído." canal="whatsapp" wa={128} equipe={0} />
      <Abertura />
      <Painel titulo="Dentro de uma conversa" nota="O trilho não some: o canal continua legível e trocar dele é um clique. O '+' sai de cena." canal="equipe" wa={7} equipe={1} emConversa />
    </div>
  </div>
);

export default ChatChannelRailPreview;
