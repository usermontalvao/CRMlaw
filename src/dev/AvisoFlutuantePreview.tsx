// DEV-ONLY: bancada do aviso flutuante (?avisopreview=1, &escuro=1).
//
// O pop-up de notificação só aparece quando o banco resolve mandar um — e some
// em dez segundos. Conferir "como fica o prazo fatal", "como fica no escuro" ou
// "como ficam três ao mesmo tempo" exigiria produzir a situação e ficar de olho
// no relógio. Aqui os modelos ficam parados, lado a lado, sobre um fundo que
// imita a tela do CRM.
//
// ── AS DUAS FAMÍLIAS ─────────────────────────────────────────────────────────
//
// Hoje o CRM tem DOIS avisos flutuantes, desenhados em épocas diferentes e sem
// parentesco visual nenhum:
//
//  · o do SINO (`NotificationBell` → `PopupItem`), no canto inferior direito:
//    caixa clara, faixa colorida no topo, azul-ardósia no texto (#0f172a,
//    #64748b — uma cor que não existe em nenhuma outra tela do sistema);
//  · o do WHATSAPP (`WhatsAppMessageToast`), no canto superior direito: faixa
//    de vidro com desfoque, rosto de quem falou, selo verde, miniatura da mídia.
//
// O segundo é melhor. A bancada leva o acabamento DELE para o primeiro — um
// chassi só (raio 18, fio de 1px, sombra em duas camadas e o brilho interno que
// levanta o cartão do fundo) — e devolve à família do WhatsApp o que só o sino
// tem: ação dentro do aviso.
//
// O que for escolhido entra no lugar do `PopupItem` sem redesenho: todos leem o
// mesmo formato que o sino já entrega (título, mensagem, `metadata.urgency`,
// módulo de origem, progresso da assinatura).
import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellOff,
  CalendarDays,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  FileSignature,
  Gavel,
  Image as ImageIcon,
  Mic,
  MoonStar,
  Send,
  Sun,
  UserPlus,
  X,
} from 'lucide-react';
import { coresDoNome } from '../components/chat/avatarColors';

/* ─────────────────────────────────────────────────────────────
   O CHASSI — a única casca, para as duas famílias
   ───────────────────────────────────────────────────────────── */

/**
 * A fórmula da sombra é a do cartão do WhatsApp, que é o mais bem-acabado que o
 * CRM tem hoje: duas camadas (uma larga e difusa que descola do fundo, uma curta
 * que assenta a peça) mais um fio de luz interno no topo. É esse fio que faz o
 * branco sobre creme parecer um objeto, e não um recorte.
 */
const chassi = (escuro: boolean, vidro = false): React.CSSProperties => ({
  background: vidro
    ? escuro ? 'rgba(26,25,23,.86)' : 'rgba(255,255,255,.86)'
    : escuro ? '#1d1c1a' : '#ffffff',
  border: `1px solid ${escuro ? 'rgba(255,255,255,.09)' : 'rgba(28,25,23,.07)'}`,
  borderRadius: 18,
  boxShadow: escuro
    ? '0 22px 48px -22px rgba(0,0,0,.85), 0 6px 16px -10px rgba(0,0,0,.6), inset 0 1px 0 0 rgba(255,255,255,.05)'
    : '0 20px 44px -22px rgba(26,24,21,.42), 0 6px 16px -10px rgba(26,24,21,.16), inset 0 1px 0 0 rgba(255,255,255,.9)',
  ...(vidro
    ? { backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)' }
    : {}),
});

/** A tinta. Três níveis, e nenhum deles é o azul-ardósia do pop-up atual. */
const tinta = (escuro: boolean) => ({
  forte: escuro ? '#f0ece6' : '#1a1815',
  media: escuro ? '#a9a29a' : '#57534e',
  fraca: escuro ? '#7c746b' : '#a09890',
  fio: escuro ? 'rgba(255,255,255,.09)' : 'rgba(28,25,23,.08)',
  trilho: escuro ? 'rgba(255,255,255,.07)' : 'rgba(28,25,23,.06)',
});

/* ─────────────────────────────────────────────────────────────
   O AVISO — o mesmo formato que o sino já entrega
   ───────────────────────────────────────────────────────────── */

type Gravidade = 'fatal' | 'alta' | 'media' | 'info' | 'ok';
type Modulo = 'prazo' | 'intimacao' | 'conversa' | 'assinatura' | 'agenda' | 'acesso';

interface Aviso {
  gravidade: Gravidade;
  modulo: Modulo;
  titulo: string;
  texto: string;
  quando: string;
  selo?: string;
  contexto?: string;
  acaoPrincipal?: string;
  acaoSecundaria?: string;
}

/**
 * A cor é da GRAVIDADE, não do módulo: é ela que muda a decisão de quem lê.
 * Tons assentados de propósito — o vermelho de alarme (#ef4444) e o laranja
 * puro do pop-up atual gritam sobre o creme do CRM e brigam com o laranja da
 * marca, que aqui fica reservado para AÇÃO.
 */
const CORES: Record<Gravidade, { forte: string; fraca: string; texto: string; escuroBg: string; escuroFg: string }> = {
  fatal: { forte: '#c62828', fraca: '#fdecea', texto: '#a92019', escuroBg: '#3a1614', escuroFg: '#f2a5a0' },
  alta: { forte: '#dd6b20', fraca: '#fdf1e7', texto: '#a9500f', escuroBg: '#38210f', escuroFg: '#f0b27f' },
  media: { forte: '#c08a1e', fraca: '#fbf4e4', texto: '#94660d', escuroBg: '#312512', escuroFg: '#e3bf6d' },
  info: { forte: '#2b6ca3', fraca: '#ecf3f9', texto: '#1f5580', escuroBg: '#132430', escuroFg: '#8fc0e4' },
  ok: { forte: '#127c5c', fraca: '#e9f4f0', texto: '#0d6248', escuroBg: '#0f2820', escuroFg: '#6ec5a5' },
};

const ICONES: Record<Modulo, React.ElementType> = {
  prazo: Clock,
  intimacao: Gavel,
  conversa: CornerUpLeft,
  assinatura: FileSignature,
  agenda: CalendarDays,
  acesso: UserPlus,
};

const AMOSTRAS: Record<Gravidade, Aviso> = {
  fatal: {
    gravidade: 'fatal',
    modulo: 'prazo',
    titulo: 'Prazo vence hoje, 23h59',
    texto: 'Contestação — Souza & Lima Ltda',
    contexto: '1002345-67.2026.8.11.0041',
    quando: '08:42',
    selo: 'Fatal',
    acaoPrincipal: 'Dar baixa',
    acaoSecundaria: 'Abrir petição',
  },
  alta: {
    gravidade: 'alta',
    modulo: 'intimacao',
    titulo: 'Intimação urgente no DJEN',
    texto: 'Audiência designada para 23/08',
    contexto: 'TJMT · 4ª Vara Cível',
    quando: '08:14',
    selo: 'Urgente',
    acaoPrincipal: 'Ver intimação',
    acaoSecundaria: 'Cadastrar prazo',
  },
  media: {
    gravidade: 'media',
    modulo: 'conversa',
    titulo: 'Maria Aparecida espera há 1h12',
    texto: 'Sem resposta desde as 07:46',
    contexto: 'Canal Atendimento',
    quando: '07:46',
    selo: 'SLA estourando',
    acaoPrincipal: 'Responder',
    acaoSecundaria: 'Passar ao setor',
  },
  info: {
    gravidade: 'info',
    modulo: 'agenda',
    titulo: 'Reunião em 40 minutos',
    texto: 'Alinhamento de acordo — sala 2',
    contexto: 'com Dra. Ana',
    quando: '09:00',
    acaoPrincipal: 'Abrir agenda',
  },
  ok: {
    gravidade: 'ok',
    modulo: 'assinatura',
    titulo: 'Kit de assinatura concluído',
    texto: 'Procuração · João Batista Ferreira',
    quando: 'agora',
    selo: 'Concluído',
    acaoPrincipal: 'Baixar PDF',
  },
};

/* ─────────────────────────────────────────────────────────────
   PEÇAS COMPARTILHADAS
   ───────────────────────────────────────────────────────────── */

/** O quadrado do módulo. 38px, raio 12 — a mesma medida do avatar de gente. */
const Emblema: React.FC<{ modulo: Modulo; gravidade: Gravidade; escuro: boolean }> = ({ modulo, gravidade, escuro }) => {
  const c = CORES[gravidade];
  const Icone = ICONES[modulo];
  return (
    <span
      className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center shrink-0"
      style={{ background: escuro ? c.escuroBg : c.fraca, color: escuro ? c.escuroFg : c.texto }}
    >
      <Icone className="w-[17px] h-[17px]" strokeWidth={1.9} />
    </span>
  );
};

/**
 * O rosto de quem falou, com a cor derivada do NOME — a mesma função que a inbox
 * e o chat já usam (`coresDoNome`), para a mesma pessoa ter sempre a mesma cor
 * em qualquer lugar do sistema.
 */
const Avatar: React.FC<{ nome: string; tamanho?: number; escuro: boolean; children?: React.ReactNode }> = ({
  nome,
  tamanho = 44,
  escuro,
  children,
}) => {
  const cor = coresDoNome(nome);
  const iniciais = nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  // A paleta de `coresDoNome` é de fundo CLARO com letra escura — no escuro ela
  // vira uma bolha pálida com as iniciais ilegíveis (o chat nunca viu isso
  // porque força superfície clara com `cw-light`). Aqui os dois papéis se
  // invertem mantendo o MESMO tom: a cor da pessoa não muda entre os temas.
  const fundo = escuro ? `color-mix(in srgb, ${cor.fg} 34%, #171513)` : cor.bg;
  const letra = escuro ? cor.bg : cor.fg;
  // `inline-flex` e não `inline`: em span puro a largura não se aplica, e o
  // rosto encolhe quando o avatar não é filho direto de um flex — é o caso da
  // pilha de rostos do modelo 12.
  return (
    <span className="relative shrink-0 inline-flex" style={{ width: tamanho, height: tamanho }}>
      <span
        className="w-full h-full rounded-full flex items-center justify-center font-semibold"
        style={{
          background: cor.bg,
          color: cor.fg,
          fontSize: tamanho * 0.34,
          boxShadow: escuro ? 'inset 0 0 0 1px rgba(255,255,255,.06)' : 'inset 0 0 0 1px rgba(28,25,23,.05)',
        }}
      >
        {iniciais}
      </span>
      {children}
    </span>
  );
};

/** O selo verde no canto da foto: diz de onde veio sem escrever "WhatsApp". */
const SeloWhatsApp: React.FC = () => (
  <span
    className="absolute -bottom-0.5 -right-0.5 w-[19px] h-[19px] rounded-full flex items-center justify-center"
    style={{ background: '#25d366', boxShadow: '0 0 0 2px var(--fundo-do-aviso, #fff)' }}
  >
    <svg viewBox="0 0 24 24" className="w-[11px] h-[11px]" fill="#fff">
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2.05 22l5.3-1.38a9.87 9.87 0 0 0 4.69 1.19h.01c5.45 0 9.89-4.44 9.89-9.9 0-2.64-1.03-5.12-2.9-6.99A9.82 9.82 0 0 0 12.04 2Zm5.8 14.06c-.24.68-1.42 1.31-1.96 1.35-.5.05-.98.23-3.35-.7-2.82-1.12-4.6-4-4.74-4.19-.14-.19-1.13-1.5-1.13-2.87 0-1.36.71-2.03.96-2.31.25-.28.55-.35.73-.35.18 0 .37 0 .53.01.17.01.4-.06.62.48.24.57.8 1.97.87 2.11.07.14.12.31.02.5-.09.19-.14.31-.28.47-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.28.72 1.18 1.54 1.92 1.06.94 1.95 1.24 2.23 1.38.28.14.44.12.6-.07.17-.19.7-.81.88-1.09.19-.28.37-.23.63-.14.25.09 1.63.77 1.91.91.28.14.47.21.53.32.07.12.07.66-.17 1.34Z" />
    </svg>
  </span>
);

/** A barra de vida: fina, com a ponta arredondada e recuada do fio de gravidade. */
const BarraDeVida: React.FC<{ cor: string; escuro: boolean; pct?: number }> = ({ cor, escuro, pct = 58 }) => (
  <div className="px-3 pb-2 -mt-1">
    <div className="h-[2px] rounded-full" style={{ background: tinta(escuro).trilho }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor, opacity: 0.5 }} />
    </div>
  </div>
);

const Botao: React.FC<{ cor?: string; escuro: boolean; children: React.ReactNode; discreto?: boolean }> = ({
  cor,
  escuro,
  children,
  discreto,
}) => (
  <button
    className="text-[11.5px] font-semibold px-2.5 py-[5px] rounded-[9px] transition-colors"
    style={
      discreto
        ? { border: `1px solid ${tinta(escuro).fio}`, color: tinta(escuro).media }
        : { background: cor, color: '#fff' }
    }
  >
    {children}
  </button>
);

/* ═════════════════════════════════════════════════════════════
   FAMÍLIA A — os avisos do sistema (prazo, intimação, agenda…)
   ═════════════════════════════════════════════════════════════ */

/* 1 — FIO DE GRAVIDADE
   O parente próximo do atual: mesma caixa, mesma largura. Muda o que a cor diz
   — sai a faixa no topo (que se perde no canto da tela) e entra um fio na
   lateral, que o olho encontra antes de ler; e a ação passa a caber no aviso. */
const ModeloFio: React.FC<{ aviso: Aviso; escuro: boolean }> = ({ aviso, escuro }) => {
  const c = CORES[aviso.gravidade];
  const t = tinta(escuro);
  return (
    <div className="w-[380px] max-w-full overflow-hidden relative" style={chassi(escuro)}>
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: c.forte }} />
      <div className="flex gap-3 pl-[16px] pr-2.5 pt-3 pb-2.5">
        <Emblema modulo={aviso.modulo} gravidade={aviso.gravidade} escuro={escuro} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <p className="text-[14px] font-semibold leading-tight tracking-[-.01em] truncate" style={{ color: t.forte }}>
              {aviso.titulo}
            </p>
            <span className="ml-auto text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: t.fraca }}>
              {aviso.quando}
            </span>
          </div>
          <p className="text-[13px] leading-[1.35] mt-[3px]" style={{ color: t.media }}>
            {aviso.texto}
          </p>
          {(aviso.selo || aviso.contexto) && (
            <div className="flex flex-wrap items-center gap-2 mt-[7px]">
              {aviso.selo && (
                <span
                  className="text-[9.5px] font-bold uppercase tracking-[.1em] px-[7px] py-[3px] rounded-[7px]"
                  style={{ background: escuro ? c.escuroBg : c.fraca, color: escuro ? c.escuroFg : c.texto }}
                >
                  {aviso.selo}
                </span>
              )}
              {aviso.contexto && (
                <span className="text-[11.5px] tabular-nums truncate" style={{ color: t.fraca }}>
                  {aviso.contexto}
                </span>
              )}
            </div>
          )}
          {aviso.acaoPrincipal && (
            <div className="flex gap-1.5 mt-2.5">
              <Botao cor={c.forte} escuro={escuro}>{aviso.acaoPrincipal}</Botao>
              {aviso.acaoSecundaria && <Botao escuro={escuro} discreto>{aviso.acaoSecundaria}</Botao>}
            </div>
          )}
        </div>
        <button className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center self-start" style={{ color: t.fraca }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <BarraDeVida cor={c.forte} escuro={escuro} />
    </div>
  );
};

/* 2 — CAPA DE DOSSIÊ
   A cor deixa de ser um detalhe e vira uma COLUNA, com o ícone dentro. Lê-se a
   gravidade de longe, sem precisar do texto — o modelo para quem trabalha com a
   tela cheia de janelas e olha o canto de esguelha. */
const ModeloCapa: React.FC<{ aviso: Aviso; escuro: boolean }> = ({ aviso, escuro }) => {
  const c = CORES[aviso.gravidade];
  const t = tinta(escuro);
  const Icone = ICONES[aviso.modulo];
  return (
    <div className="w-[380px] max-w-full overflow-hidden flex" style={chassi(escuro)}>
      <div
        className="w-[56px] shrink-0 flex flex-col items-center justify-center gap-1.5"
        style={{ background: c.forte }}
      >
        <Icone className="w-[19px] h-[19px] text-white" strokeWidth={1.9} />
        <span className="text-[8.5px] font-bold uppercase tracking-[.12em] text-white/90">{aviso.selo ?? 'Aviso'}</span>
      </div>
      <div className="min-w-0 flex-1 py-3 px-4">
        <div className="flex items-baseline gap-2.5">
          <p className="text-[14px] font-semibold leading-tight tracking-[-.01em] truncate" style={{ color: t.forte }}>
            {aviso.titulo}
          </p>
          <span className="ml-auto text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: t.fraca }}>
            {aviso.quando}
          </span>
        </div>
        <p className="text-[13px] leading-[1.35] mt-[3px]" style={{ color: t.media }}>
          {aviso.texto}
        </p>
        {aviso.contexto && (
          <p className="text-[11.5px] mt-[3px] tabular-nums" style={{ color: t.fraca }}>
            {aviso.contexto}
          </p>
        )}
        {aviso.acaoPrincipal && (
          <div className="flex items-center gap-3.5 mt-2.5">
            <button className="text-[12px] font-bold flex items-center gap-1" style={{ color: c.forte }}>
              {aviso.acaoPrincipal}
              <ArrowRight className="w-3 h-3" strokeWidth={2.4} />
            </button>
            {aviso.acaoSecundaria && (
              <button className="text-[12px] font-medium" style={{ color: t.fraca }}>
                {aviso.acaoSecundaria}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* 3 — LINHA COMPACTA
   Nem todo aviso merece um cartão. O que é informativo cabe numa pastilha de uma
   linha, que ocupa um quinto do espaço e não cobre o que a pessoa está fazendo. */
const ModeloLinha: React.FC<{ aviso: Aviso; escuro: boolean }> = ({ aviso, escuro }) => {
  const c = CORES[aviso.gravidade];
  const t = tinta(escuro);
  const Icone = ICONES[aviso.modulo];
  return (
    <div
      className="w-[380px] max-w-full flex items-center gap-2.5 pl-2 pr-2.5 py-[7px]"
      style={{ ...chassi(escuro), borderRadius: 999 }}
    >
      <span
        className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0"
        style={{ background: escuro ? c.escuroBg : c.fraca, color: escuro ? c.escuroFg : c.texto }}
      >
        <Icone className="w-[15px] h-[15px]" strokeWidth={1.9} />
      </span>
      <p className="text-[13px] font-semibold truncate min-w-0 flex-1 tracking-[-.005em]" style={{ color: t.forte }}>
        {aviso.titulo}
      </p>
      <span className="text-[11.5px] tabular-nums shrink-0" style={{ color: t.fraca }}>
        {aviso.quando}
      </span>
      <button
        className="text-[11.5px] font-semibold shrink-0 px-2.5 py-[3px] rounded-full whitespace-nowrap"
        style={{ background: escuro ? c.escuroBg : c.fraca, color: escuro ? c.escuroFg : c.texto }}
      >
        {aviso.acaoPrincipal ?? 'Ver'}
      </button>
    </div>
  );
};

/* 4 — VIDRO
   O acabamento que o cartão do WhatsApp já tem, aplicado ao aviso do sistema:
   fundo translúcido com desfoque, que pega a cor da tela por trás. Aqui em cima
   de qualquer coisa — inclusive de outro programa. */
const ModeloVidro: React.FC<{ aviso: Aviso; escuro: boolean }> = ({ aviso, escuro }) => {
  const c = CORES[aviso.gravidade];
  const t = tinta(escuro);
  return (
    <div className="w-[380px] max-w-full overflow-hidden relative" style={chassi(escuro, true)}>
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: c.forte }} />
      <div className="flex gap-3 pl-[16px] pr-2.5 py-3">
        <Emblema modulo={aviso.modulo} gravidade={aviso.gravidade} escuro={escuro} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {aviso.selo && (
              <span
                className="text-[9.5px] font-bold uppercase tracking-[.12em]"
                style={{ color: escuro ? c.escuroFg : c.texto }}
              >
                {aviso.selo}
              </span>
            )}
            <span className="ml-auto text-[11.5px] font-medium tabular-nums" style={{ color: t.fraca }}>
              {aviso.quando}
            </span>
          </div>
          <p className="text-[14px] font-semibold leading-tight tracking-[-.01em] mt-[3px]" style={{ color: t.forte }}>
            {aviso.titulo}
          </p>
          <p className="text-[13px] leading-[1.35] mt-[2px]" style={{ color: t.media }}>
            {aviso.texto}
          </p>
          {aviso.acaoPrincipal && (
            <div className="flex gap-1.5 mt-2.5">
              <Botao cor={c.forte} escuro={escuro}>{aviso.acaoPrincipal}</Botao>
              <Botao escuro={escuro} discreto>Depois</Botao>
            </div>
          )}
        </div>
      </div>
      <BarraDeVida cor={c.forte} escuro={escuro} />
    </div>
  );
};

/* 5 — PILHA
   Três avisos ao mesmo tempo hoje viram três caixas empilhando a tela. Aqui
   viram uma pilha: o de cima é o novo, os de baixo aparecem como lombada. */
const ModeloPilha: React.FC<{ aviso: Aviso; escuro: boolean }> = ({ aviso, escuro }) => {
  const t = tinta(escuro);
  return (
    <div className="w-[392px] max-w-full">
      {/* O container se mede pelo cartão da frente, e as lombadas descem abaixo
          dele (`bottom` negativo em relação ao conteúdo) — é o que mantém a
          pilha visível quando o aviso de cima cresce com as ações. */}
      <div className="relative isolate pb-5">
        <div
          className="absolute right-[18px] top-[24px] bottom-[0px] w-[324px] rounded-[18px] z-[1]"
          style={{
            background: escuro ? '#151413' : '#f1eee9',
            border: `1px solid ${t.fio}`,
          }}
        />
        <div
          className="absolute right-[9px] top-[12px] bottom-[12px] w-[342px] rounded-[18px] z-[2]"
          style={{
            background: escuro ? '#1a1918' : '#f8f6f2',
            border: `1px solid ${t.fio}`,
          }}
        />
        <div className="relative z-[3]">
          <ModeloFio aviso={aviso} escuro={escuro} />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          className="flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-[6px] rounded-full"
          style={{ ...chassi(escuro), borderRadius: 999, color: t.media }}
        >
          <span
            className="w-[15px] h-[15px] rounded-full text-[9px] font-bold text-white flex items-center justify-center"
            style={{ background: CORES[aviso.gravidade].forte }}
          >
            2
          </span>
          avisos esperando
        </button>
      </div>
    </div>
  );
};

/* 6 — FAIXA DE TOPO
   Só para o que não pode passar. Atravessa o alto da tela com o relógio
   correndo, e não tem contador para sumir: sai quando o prazo recebe baixa. */
const ModeloFaixa: React.FC<{ aviso: Aviso; escuro: boolean }> = ({ aviso, escuro }) => {
  const c = CORES[aviso.gravidade];
  const t = tinta(escuro);
  return (
    <div
      className="w-[640px] max-w-full flex items-center gap-3.5 px-4 py-3"
      style={{ ...chassi(escuro), borderLeft: `3px solid ${c.forte}` }}
    >
      <span
        className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center shrink-0"
        style={{ background: escuro ? c.escuroBg : c.fraca, color: escuro ? c.escuroFg : c.texto }}
      >
        <AlertTriangle className="w-[17px] h-[17px]" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2.5">
          <p className="text-[13.5px] font-semibold tracking-[-.01em] truncate" style={{ color: t.forte }}>
            {aviso.titulo}
          </p>
          <span className="text-[12px] font-semibold tabular-nums shrink-0" style={{ color: c.forte }}>
            faltam 15h42
          </span>
        </div>
        <p className="text-[12.5px] truncate mt-[1px]" style={{ color: t.media }}>
          {aviso.texto} — responsável: você
        </p>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Botao cor={c.forte} escuro={escuro}>{aviso.acaoPrincipal ?? 'Resolver'}</Botao>
        <Botao escuro={escuro} discreto>Passar adiante</Botao>
      </div>
    </div>
  );
};

/* 7 — DEPOIS DE AGIR
   O que aparece no lugar do aviso quando a ação é feita por ele. Vale para
   qualquer modelo: a caixa não some na hora, ela vira o comprovante — com dez
   segundos para desfazer. */
const ModeloDesfazer: React.FC<{ escuro: boolean }> = ({ escuro }) => {
  const c = CORES.ok;
  const t = tinta(escuro);
  return (
    <div className="w-[380px] max-w-full overflow-hidden relative" style={chassi(escuro)}>
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: c.forte }} />
      <div className="flex items-center gap-3 pl-[16px] pr-2.5 pt-3 pb-2.5">
        <span
          className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center shrink-0"
          style={{ background: escuro ? c.escuroBg : c.fraca, color: escuro ? c.escuroFg : c.texto }}
        >
          <CheckCheck className="w-[17px] h-[17px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight tracking-[-.01em]" style={{ color: t.forte }}>
            Prazo dado como cumprido
          </p>
          <p className="text-[13px] leading-[1.35] mt-[2px]" style={{ color: t.media }}>
            Contestação — Souza &amp; Lima
          </p>
        </div>
        <Botao escuro={escuro} discreto>Desfazer</Botao>
      </div>
      <BarraDeVida cor={c.forte} escuro={escuro} pct={28} />
    </div>
  );
};

/* 8 — PROGRESSO
   Para o aviso que conta uma história em andamento: assinatura, importação,
   envio em massa. A barra é o conteúdo, não enfeite. */
const ModeloProgresso: React.FC<{ escuro: boolean }> = ({ escuro }) => {
  const c = CORES.info;
  const t = tinta(escuro);
  const pct = 67;
  return (
    <div className="w-[380px] max-w-full overflow-hidden relative" style={chassi(escuro)}>
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: c.forte }} />
      <div className="flex gap-3 pl-[16px] pr-2.5 py-3">
        <Emblema modulo="assinatura" gravidade="info" escuro={escuro} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <p className="text-[14px] font-semibold leading-tight tracking-[-.01em] truncate" style={{ color: t.forte }}>
              Kit de assinatura em andamento
            </p>
            <span className="ml-auto text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: t.fraca }}>
              agora
            </span>
          </div>
          <p className="text-[13px] leading-[1.35] mt-[3px]" style={{ color: t.media }}>
            Procuração · João Batista Ferreira
          </p>
          <div className="mt-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium" style={{ color: t.media }}>
                2 de 3 assinaram · falta Ana Paula
              </span>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: c.forte }}>
                {pct}%
              </span>
            </div>
            <div className="h-[3px] rounded-full overflow-hidden" style={{ background: t.trilho }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.forte }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════
   FAMÍLIA B — a mensagem de gente (WhatsApp)

   Aqui o assunto não é gravidade, é QUEM FALOU: o rosto ocupa o lugar do ícone
   do módulo e o selo verde diz de onde veio. O que estes modelos acrescentam ao
   cartão que já existe é a AÇÃO — hoje o clique só abre a conversa, e responder
   "já vou ver" custa sair da tela em que se está.
   ═════════════════════════════════════════════════════════════ */

const VERDE = '#128c5a';

/* 9 — MENSAGEM DE TEXTO
   O cartão de hoje, no chassi novo: rosto, nome, prévia e hora real. O que muda
   é o rodapé — responder e silenciar sem abrir a conversa. */
const ModeloWhatsAppTexto: React.FC<{ escuro: boolean }> = ({ escuro }) => {
  const t = tinta(escuro);
  return (
    <div
      className="w-[400px] max-w-full overflow-hidden"
      style={{ ...chassi(escuro, true), ['--fundo-do-aviso' as string]: escuro ? '#1d1c1a' : '#fff' }}
    >
      <div className="flex items-center gap-[13px] px-[15px] pt-[13px] pb-2.5">
        <Avatar nome="Maria Aparecida Souza" escuro={escuro}>
          <SeloWhatsApp />
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <p className="text-[14.5px] font-semibold leading-tight tracking-[-.01em] truncate" style={{ color: t.forte }}>
              Maria Aparecida Souza
            </p>
            <span className="ml-auto text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: t.fraca }}>
              07:46
            </span>
          </div>
          <div className="flex items-center gap-2 mt-[3px]">
            <p className="text-[13.5px] leading-[1.35] truncate min-w-0 flex-1" style={{ color: t.media }}>
              Conseguiu ver o documento?
            </p>
            <span
              className="shrink-0 text-[11px] font-semibold px-[9px] py-[2px] rounded-full"
              style={{ background: escuro ? '#12301f' : '#e7f5ed', color: escuro ? '#6ee7a8' : VERDE }}
            >
              3 novas
            </span>
          </div>
        </div>
      </div>
      <div
        className="flex items-center gap-1.5 px-[15px] py-2.5"
        style={{ borderTop: `1px solid ${t.fio}` }}
      >
        <Botao cor={VERDE} escuro={escuro}>Responder aqui</Botao>
        <Botao escuro={escuro} discreto>Abrir conversa</Botao>
        <button className="ml-auto flex items-center gap-1 text-[11.5px] font-medium" style={{ color: t.fraca }}>
          <BellOff className="w-3.5 h-3.5" strokeWidth={1.9} />
          Silenciar 1h
        </button>
      </div>
    </div>
  );
};

/* 10 — RESPOSTA RÁPIDA
   O mesmo cartão com o campo aberto: "já estou vendo" sai daqui, sem trocar de
   tela e sem carregar o módulo inteiro. O envio passa pela mesma porta do
   compositor — mesma fila, mesmo registro, mesmo SLA. */
const ModeloWhatsAppResposta: React.FC<{ escuro: boolean }> = ({ escuro }) => {
  const t = tinta(escuro);
  return (
    <div
      className="w-[400px] max-w-full overflow-hidden"
      style={{ ...chassi(escuro, true), ['--fundo-do-aviso' as string]: escuro ? '#1d1c1a' : '#fff' }}
    >
      <div className="flex items-center gap-[13px] px-[15px] pt-[13px] pb-2.5">
        <Avatar nome="Maria Aparecida Souza" tamanho={38} escuro={escuro}>
          <SeloWhatsApp />
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <p className="text-[14px] font-semibold leading-tight tracking-[-.01em] truncate" style={{ color: t.forte }}>
              Maria Aparecida Souza
            </p>
            <span className="ml-auto text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: t.fraca }}>
              07:46
            </span>
          </div>
          <p className="text-[13px] leading-[1.35] truncate mt-[2px]" style={{ color: t.media }}>
            Bom dia, conseguiu ver aquele documento?
          </p>
        </div>
      </div>
      <div className="px-[15px] pb-3">
        <div
          className="flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 rounded-full"
          style={{ background: escuro ? 'rgba(255,255,255,.05)' : '#f5f3ef', border: `1px solid ${t.fio}` }}
        >
          <span className="text-[13px] flex-1 min-w-0 truncate" style={{ color: t.forte }}>
            Já estou vendo, Maria — te respondo em 10 minutos
            <span className="inline-block w-[1.5px] h-[13px] align-middle ml-[1px] animate-pulse" style={{ background: VERDE }} />
          </span>
          <button
            className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0"
            style={{ background: VERDE, color: '#fff' }}
          >
            <Send className="w-[14px] h-[14px]" strokeWidth={2} />
          </button>
        </div>
        <div className="flex gap-1.5 mt-2">
          {['Já estou vendo', 'Bom dia! Já retorno', 'Pode me ligar?'].map((sugestao) => (
            <span
              key={sugestao}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{ border: `1px solid ${t.fio}`, color: t.media }}
            >
              {sugestao}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

/* 11 — MÍDIA E ÁUDIO
   A miniatura é o que faz o aviso ser resolvido sem abrir a conversa: dá para
   reconhecer de relance um comprovante fotografado. O áudio diz a duração —
   "0:42" muda a decisão de ouvir agora ou depois. */
const ModeloWhatsAppMidia: React.FC<{ escuro: boolean }> = ({ escuro }) => {
  const t = tinta(escuro);
  return (
    <div className="grid gap-2.5 w-[400px] max-w-full">
      <div
        className="overflow-hidden"
        style={{ ...chassi(escuro, true), ['--fundo-do-aviso' as string]: escuro ? '#1d1c1a' : '#fff' }}
      >
        <div className="flex items-center gap-[13px] px-[15px] py-[13px]">
          <Avatar nome="João Batista Ferreira" escuro={escuro}>
            <SeloWhatsApp />
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <p className="text-[14.5px] font-semibold leading-tight tracking-[-.01em] truncate" style={{ color: t.forte }}>
                João Batista Ferreira
              </p>
              <span className="ml-auto text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: t.fraca }}>
                09:12
              </span>
            </div>
            <span className="flex items-center gap-1.5 mt-[3px] text-[13.5px]" style={{ color: t.media }}>
              <ImageIcon className="w-[15px] h-[15px] shrink-0" style={{ color: VERDE }} strokeWidth={1.9} />
              Comprovante de residência
            </span>
          </div>
          {/* A miniatura de verdade (aqui simulada: um documento fotografado).
              É ela que resolve o aviso sem abrir a conversa — o ícone genérico
              dizia apenas "veio uma foto", que é quase não dizer nada. */}
          <span
            className="w-[42px] h-[42px] rounded-[10px] shrink-0 relative overflow-hidden"
            style={{
              background: 'linear-gradient(150deg, #c9c2b6 0%, #e6e0d5 55%, #d5cec2 100%)',
              boxShadow: 'inset 0 0 0 1px rgba(28,25,23,.12)',
            }}
          >
            <span className="absolute inset-[6px] rounded-[3px] bg-white/90 rotate-[-3deg]" />
            {[13, 19, 25, 31].map((topo, i) => (
              <span
                key={topo}
                className="absolute h-[2px] rounded-full bg-stone-400/50"
                style={{ top: topo, left: 11, right: i === 3 ? 20 : 11 }}
              />
            ))}
          </span>
        </div>
      </div>

      <div
        className="overflow-hidden"
        style={{ ...chassi(escuro, true), ['--fundo-do-aviso' as string]: escuro ? '#1d1c1a' : '#fff' }}
      >
        <div className="flex items-center gap-[13px] px-[15px] py-[13px]">
          <Avatar nome="Roberta Aguiar" escuro={escuro}>
            <SeloWhatsApp />
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <p className="text-[14.5px] font-semibold leading-tight tracking-[-.01em] truncate" style={{ color: t.forte }}>
                Roberta Aguiar
              </p>
              <span className="ml-auto text-[11.5px] font-medium tabular-nums shrink-0" style={{ color: t.fraca }}>
                09:07
              </span>
            </div>
            <span className="flex items-center gap-1.5 mt-[3px] text-[13.5px]" style={{ color: t.media }}>
              <Mic className="w-[15px] h-[15px] shrink-0" style={{ color: VERDE }} strokeWidth={1.9} />
              Mensagem de voz
              <span className="inline-flex items-end gap-[2px] h-[13px] mx-0.5">
                {[5, 9, 13, 7, 11, 6, 10, 4].map((altura, i) => (
                  <span key={i} className="w-[2px] rounded-full" style={{ height: altura, background: VERDE, opacity: 0.55 }} />
                ))}
              </span>
              <span className="tabular-nums text-[12.5px]" style={{ color: t.fraca }}>0:42</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

/* 12 — VÁRIAS PESSOAS AO MESMO TEMPO
   Numa rajada de atendimento chegam cinco mensagens de três pessoas. Cinco
   cartões cobririam a tela; aqui viram um, com os rostos e a contagem — e o
   clique leva para a caixa de entrada, não para uma conversa escolhida a esmo. */
const ModeloWhatsAppRajada: React.FC<{ escuro: boolean }> = ({ escuro }) => {
  const t = tinta(escuro);
  const pessoas = ['Maria Aparecida Souza', 'João Batista Ferreira', 'Roberta Aguiar'];
  return (
    <div
      className="w-[400px] max-w-full overflow-hidden"
      style={{ ...chassi(escuro, true), ['--fundo-do-aviso' as string]: escuro ? '#1d1c1a' : '#fff' }}
    >
      <div className="flex items-center gap-[13px] px-[15px] py-[13px]">
        {/* Os rostos sobrepostos: o ÚLTIMO fica na frente, e é nele que mora o
            selo verde — no primeiro, ele seria coberto pelo rosto seguinte. */}
        <span className="flex shrink-0 items-center">
          {pessoas.map((nome, i) => (
            <span
              key={nome}
              className="relative rounded-full"
              style={{
                marginLeft: i === 0 ? 0 : -13,
                zIndex: i,
                boxShadow: `0 0 0 2.5px ${escuro ? '#1d1c1a' : '#fff'}`,
              }}
            >
              <Avatar nome={nome} tamanho={40} escuro={escuro}>
                {i === pessoas.length - 1 ? <SeloWhatsApp /> : null}
              </Avatar>
            </span>
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold leading-tight tracking-[-.01em]" style={{ color: t.forte }}>
            5 mensagens de 3 pessoas
          </p>
          <p className="text-[13.5px] leading-[1.35] mt-[3px] truncate" style={{ color: t.media }}>
            Maria, João e Roberta — nos últimos 4 minutos
          </p>
        </div>
        <button
          className="shrink-0 w-[30px] h-[30px] rounded-full flex items-center justify-center"
          style={{ background: VERDE, color: '#fff' }}
        >
          <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────
   A BANCADA
   ───────────────────────────────────────────────────────────── */

const GRAVIDADES: Array<{ id: Gravidade; nome: string }> = [
  { id: 'fatal', nome: 'Prazo fatal' },
  { id: 'alta', nome: 'Intimação urgente' },
  { id: 'media', nome: 'Cliente esperando' },
  { id: 'info', nome: 'Compromisso' },
  { id: 'ok', nome: 'Assinatura pronta' },
];

const Vitrine: React.FC<{
  nome: string;
  quando: string;
  escuro: boolean;
  larga?: boolean;
  children: React.ReactNode;
}> = ({ nome, quando, escuro, larga, children }) => (
  <section className={larga ? 'md:col-span-2' : ''}>
    <h3 className={`text-[14px] font-semibold tracking-[-.01em] ${escuro ? 'text-zinc-100' : 'text-stone-900'}`}>{nome}</h3>
    <p className={`text-[12.5px] leading-[1.5] mt-1 mb-4 max-w-[54ch] ${escuro ? 'text-zinc-400' : 'text-stone-500'}`}>
      {quando}
    </p>
    <div
      className="rounded-[20px] py-8 px-6 flex justify-center"
      style={{
        background: escuro ? '#0c0b0a' : '#efece7',
        boxShadow: escuro ? 'inset 0 0 0 1px rgba(255,255,255,.04)' : 'inset 0 0 0 1px rgba(28,25,23,.05)',
      }}
    >
      {children}
    </div>
  </section>
);

const Titulo: React.FC<{ escuro: boolean; children: React.ReactNode; nota: string }> = ({ escuro, children, nota }) => (
  <div className="mt-16 mb-8 first:mt-0">
    <h2 className={`text-[19px] font-semibold tracking-[-.015em] ${escuro ? 'text-zinc-50' : 'text-stone-900'}`}>
      {children}
    </h2>
    <p className={`text-[13px] mt-1.5 max-w-[76ch] ${escuro ? 'text-zinc-400' : 'text-stone-500'}`}>{nota}</p>
  </div>
);

export const AvisoFlutuantePreview: React.FC = () => {
  const [gravidade, setGravidade] = useState<Gravidade>('fatal');
  // `&escuro=1` abre a bancada já no escuro: é o que permite fotografar os dois
  // temas sem depender de alguém clicar no interruptor.
  const [escuro, setEscuro] = useState(() => new URLSearchParams(window.location.search).has('escuro'));
  const aviso = AMOSTRAS[gravidade];

  return (
    <div className={escuro ? 'dark' : ''}>
      <div className={`min-h-screen ${escuro ? 'bg-[#141312]' : 'bg-[#faf9f7]'}`}>
        <div
          className={`sticky top-0 z-10 px-6 py-3 flex flex-wrap items-center gap-3 border-b ${
            escuro ? 'bg-[#141312]/95 border-zinc-800' : 'bg-[#faf9f7]/95 border-stone-200'
          }`}
          style={{ backdropFilter: 'blur(10px)' }}
        >
          <span className={`text-[10.5px] font-bold uppercase tracking-[.16em] ${escuro ? 'text-orange-400' : 'text-orange-700'}`}>
            Bancada · aviso flutuante
          </span>
          <div
            className="flex gap-0.5 ml-auto flex-wrap p-0.5 rounded-full"
            style={{ background: escuro ? 'rgba(255,255,255,.05)' : '#f0ede8' }}
          >
            {GRAVIDADES.map((g) => (
              <button
                key={g.id}
                onClick={() => setGravidade(g.id)}
                className={`text-[12px] font-medium px-3 py-1 rounded-full transition ${
                  gravidade === g.id ? 'text-white' : escuro ? 'text-zinc-400' : 'text-stone-500'
                }`}
                style={gravidade === g.id ? { background: CORES[g.id].forte } : undefined}
              >
                {g.nome}
              </button>
            ))}
          </div>
          <button
            onClick={() => setEscuro((v) => !v)}
            className={`flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full border ${
              escuro ? 'border-zinc-700 text-zinc-300' : 'border-stone-300 text-stone-600'
            }`}
          >
            {escuro ? <Sun className="w-3.5 h-3.5" /> : <MoonStar className="w-3.5 h-3.5" />}
            {escuro ? 'Claro' : 'Escuro'}
          </button>
        </div>

        <div className="px-6 py-10 max-w-[1180px] mx-auto">
          <h1 className={`text-[27px] font-semibold tracking-[-.02em] ${escuro ? 'text-zinc-50' : 'text-stone-900'}`}>
            O aviso que aparece no canto — doze modelos
          </h1>
          <p className={`text-[14px] leading-relaxed mt-2.5 max-w-[70ch] ${escuro ? 'text-zinc-400' : 'text-stone-500'}`}>
            O CRM tem dois avisos flutuantes hoje, desenhados em épocas diferentes: o do sino, no canto
            inferior, e o de mensagem do WhatsApp, no superior. O segundo é mais bem acabado. Aqui os dois
            passam a usar o mesmo chassi — raio 18, fio de 1px, sombra em duas camadas e o brilho interno
            que levanta o cartão do fundo — e cada família mantém o que é seu: a cor da gravidade num,
            o rosto de quem falou no outro.
          </p>

          <Titulo escuro={escuro} nota="Prazo, intimação, compromisso, assinatura, pedido de acesso. Troque a gravidade na barra acima e veja os oito reagirem juntos.">
            Família A · avisos do sistema
          </Titulo>

          <div className="grid md:grid-cols-2 gap-x-10 gap-y-12">
            <Vitrine
              nome="1 · Fio de gravidade"
              quando="O parente próximo do atual: sai a faixa do topo, entra um fio na lateral e a ação passa a caber dentro do aviso. A troca mais barata."
              escuro={escuro}
            >
              <ModeloFio aviso={aviso} escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="2 · Capa de dossiê"
              quando="A cor vira uma coluna inteira com o ícone dentro: dá para ler a gravidade de esguelha, sem focar no texto."
              escuro={escuro}
            >
              <ModeloCapa aviso={aviso} escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="3 · Linha compacta"
              quando="Para o que é só informação. Ocupa um quinto do espaço e não cobre o que a pessoa está fazendo."
              escuro={escuro}
            >
              <ModeloLinha aviso={aviso} escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="4 · Vidro"
              quando="O acabamento do cartão do WhatsApp aplicado ao aviso do sistema: fundo translúcido, que pega a cor da tela por trás."
              escuro={escuro}
            >
              <ModeloVidro aviso={aviso} escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="5 · Pilha"
              quando="Três avisos ao mesmo tempo deixam de empilhar caixas na tela: viram uma pilha com lombadas e um contador."
              escuro={escuro}
            >
              <ModeloPilha aviso={aviso} escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="7 · Depois de agir"
              quando="O aviso não some quando você age por ele: vira o comprovante do que foi feito, com dez segundos para desfazer."
              escuro={escuro}
            >
              <ModeloDesfazer escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="6 · Faixa de topo"
              quando="Só para o que não pode passar. Não tem contador para sumir: sai quando o prazo recebe baixa ou alguém dispensa."
              escuro={escuro}
              larga
            >
              <ModeloFaixa aviso={AMOSTRAS.fatal} escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="8 · Progresso"
              quando="Para o que está em andamento — assinatura, importação, envio em massa. A barra é o conteúdo."
              escuro={escuro}
            >
              <ModeloProgresso escuro={escuro} />
            </Vitrine>
          </div>

          <Titulo
            escuro={escuro}
            nota="Aqui o assunto não é gravidade, é quem falou: o rosto ocupa o lugar do ícone e o selo verde diz de onde veio. O que estes quatro acrescentam ao cartão de hoje é a ação — responder sem sair da tela em que você está."
          >
            Família B · mensagem de WhatsApp
          </Titulo>

          <div className="grid md:grid-cols-2 gap-x-10 gap-y-12">
            <Vitrine
              nome="9 · Mensagem com rodapé de ação"
              quando="O cartão de hoje no chassi novo. O que muda é o rodapé: responder, abrir a conversa ou silenciar o contato por uma hora — sem abrir nada."
              escuro={escuro}
            >
              <ModeloWhatsAppTexto escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="10 · Resposta rápida"
              quando="O campo abre dentro do próprio aviso, com três respostas prontas do escritório. O envio passa pela mesma porta do compositor: mesma fila, mesmo registro, mesmo SLA."
              escuro={escuro}
            >
              <ModeloWhatsAppResposta escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="11 · Foto, documento e áudio"
              quando="A miniatura é o que resolve o aviso sem abrir a conversa — dá para reconhecer um comprovante de relance. O áudio diz a duração, que muda a decisão de ouvir agora ou depois."
              escuro={escuro}
            >
              <ModeloWhatsAppMidia escuro={escuro} />
            </Vitrine>

            <Vitrine
              nome="12 · Rajada de atendimento"
              quando="Cinco mensagens de três pessoas cobririam a tela de cartões. Aqui viram um, com os rostos e a contagem — e o clique leva para a caixa de entrada, não para uma conversa escolhida a esmo."
              escuro={escuro}
            >
              <ModeloWhatsAppRajada escuro={escuro} />
            </Vitrine>
          </div>

          <div
            className="mt-16 rounded-[20px] p-7"
            style={{ background: escuro ? '#1d1c1a' : '#fff', border: `1px solid ${tinta(escuro).fio}` }}
          >
            <h2 className={`text-[15px] font-semibold tracking-[-.01em] ${escuro ? 'text-zinc-100' : 'text-stone-900'}`}>
              O que muda em comum, escolhido o modelo que for
            </h2>
            <ul className={`mt-4 grid sm:grid-cols-2 gap-x-10 gap-y-2.5 text-[13px] ${escuro ? 'text-zinc-400' : 'text-stone-600'}`}>
              {[
                'Um chassi só para as duas famílias: o aviso de prazo e o de mensagem passam a ser do mesmo produto.',
                'A cor passa a significar gravidade — hoje ela mistura tipo, urgência e módulo no mesmo laranja.',
                'O aviso ganha ação: resolver, responder ou silenciar sem abrir o módulo, e desfazer por dez segundos.',
                'Some o azul-ardósia (#0f172a, #64748b) do pop-up atual, que não existe em nenhuma outra tela do CRM.',
                'O que é fatal deixa de ter contador para sumir sozinho.',
                'O rosto de quem falou usa a cor do nome — a mesma da inbox e do chat, para a pessoa não trocar de cor.',
              ].map((linha) => (
                <li key={linha} className="flex gap-2">
                  <Check className="w-4 h-4 shrink-0 mt-0.5 text-orange-500" strokeWidth={2.4} />
                  {linha}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvisoFlutuantePreview;
