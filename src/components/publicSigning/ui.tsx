/**
 * As peças das telas públicas de assinatura.
 *
 * Antes, cada momento do fluxo tinha o seu próprio mundo visual: a abertura era
 * uma sala de máquinas (escudo, documentos voando, três passos, porcentagem e
 * três selos de segurança), o envio era outra sala parecida, e o fim era um
 * certificado ESCURO com serifa e monograma. Quem assina atravessa os três em
 * menos de um minuto e trocava de tipografia e de paleta no meio do caminho.
 *
 * Aqui há um idioma só, e ele é sempre CLARO: a página do cliente não segue o
 * tema do sistema operacional dele — é uma folha, e folha é branca.
 *
 * O que muda entre as telas é o TOM, e o tom mora num lugar só: o fio de 2,5 px
 * no alto. Laranja enquanto trabalha, verde quando terminou, âmbar quando
 * espera alguém, vermelho quando deu problema. A pessoa aprende a cor uma vez.
 */
import React from 'react';
import {
  type CanalDeIdentidade,
  formatarCoordenadas,
  mascararCpf,
  rotularCanal,
} from '../../utils/assinaturaPublica';

// ── Paleta única das telas públicas ──────────────────────────────────────────
export const CHAO = '#f8fafc';
export const TINTA = '#0f172a';
export const TINTA_2 = '#64748b';
export const TINTA_3 = '#94a3b8';
export const TINTA_4 = '#cbd5e1';
export const LINHA = '#e7e5e4';
export const LARANJA = '#ea580c';
export const VERDE = '#059669';

export type Tom = 'trabalhando' | 'pronto' | 'espera' | 'problema' | 'neutro';

const COR_DO_TOM: Record<Tom, string> = {
  trabalhando: 'linear-gradient(90deg,#c2410c,#ea580c 60%,#f97316)',
  pronto: '#10b981',
  espera: '#f59e0b',
  problema: '#e11d48',
  neutro: '#cbd5e1',
};

// ── Animações. Prefixo `ap-` para não colidir com as do resto do app. ────────
(() => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ap-estilos')) return;
  const style = document.createElement('style');
  style.id = 'ap-estilos';
  style.textContent = `
    @keyframes ap-sobe { from { opacity: 0; transform: translateY(9px) } to { opacity: 1; transform: none } }
    @keyframes ap-brilho { 0% { transform: translateX(-70px) } 100% { transform: translateX(460px) } }
    @keyframes ap-varre { 0% { transform: translateY(-45%) } 100% { transform: translateY(430%) } }
    @keyframes ap-traco { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
    @keyframes ap-pulso { 0%, 100% { opacity: 1 } 50% { opacity: .4 } }
    @keyframes ap-selo {
      0%   { opacity: 0; transform: scale(1.9) rotate(-24deg) }
      70%  { opacity: 1; transform: scale(.94) rotate(-8deg) }
      100% { opacity: 1; transform: scale(1) rotate(-11deg) }
    }
    @keyframes ap-gira { to { transform: rotate(360deg) } }

    /* A demonstração do dedo. O traço usa pathLength="1", então o desenho é
       exatamente "offset 1 → 0", sem depender do comprimento real da curva. */
    @keyframes ap-desenha {
      0%        { stroke-dashoffset: 1; opacity: 1 }
      63%       { stroke-dashoffset: 0; opacity: 1 }
      84%       { stroke-dashoffset: 0; opacity: 1 }
      96%, 100% { stroke-dashoffset: 0; opacity: 0 }
    }
    @keyframes ap-dedo-some {
      0%, 84%   { opacity: 1 }
      96%, 100% { opacity: 0 }
    }
    .ap-demo-traco {
      stroke-dasharray: 1; stroke-dashoffset: 1;
      animation: ap-desenha var(--ap-demo-dur, 3.8s) linear infinite;
    }
    .ap-demo-dedo { animation: ap-dedo-some var(--ap-demo-dur, 3.8s) linear infinite; }
    @media (prefers-reduced-motion: reduce) {
      .ap-demo-traco { animation: none; stroke-dashoffset: 0; opacity: .55 }
      .ap-demo-dedo { display: none }
    }
    @media (prefers-reduced-motion: reduce) {
      .ap-anima, .ap-anima * { animation-duration: .01ms !important; animation-iteration-count: 1 !important }
    }
  `;
  document.head.appendChild(style);
})();

/** Entrada em cascata. O índice vira o atraso — sem precisar de classe por item. */
export const sobe = (ordem = 0, duracao = 0.42): React.CSSProperties => ({
  animation: `ap-sobe ${duracao}s cubic-bezier(.2,.8,.2,1) ${ordem * 0.07}s both`,
});

// ─────────────────────────────────────────────────────────────────────────────
// O fio do topo — é ele que carrega o estado da tela.
// ─────────────────────────────────────────────────────────────────────────────
export const Fio: React.FC<{ tom: Tom; progresso?: number | null; brilho?: boolean }> = ({
  tom, progresso, brilho = true,
}) => {
  if (progresso == null) {
    return <div style={{ height: 2.5, flex: '0 0 auto', background: COR_DO_TOM[tom] }} />;
  }
  return (
    <div style={{ height: 2.5, flex: '0 0 auto', background: '#eef2f6', position: 'relative', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${progresso}%`,
          transition: brilho ? 'width 200ms linear' : 'width 450ms cubic-bezier(.2,.8,.2,1)',
          background: COR_DO_TOM[tom],
        }}
      />
      {/* O brilho diz "ainda está acontecendo". Numa régua de etapas isso é
          mentira — ela está parada esperando a pessoa —, então ali ele sai. */}
      {brilho && (
        <div
          aria-hidden
          style={{
            position: 'absolute', top: 0, height: '100%', width: 70, pointerEvents: 'none',
            background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent)',
            animation: 'ap-brilho 1.8s ease-in-out infinite',
          }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// A moldura de todas as telas públicas.
// ─────────────────────────────────────────────────────────────────────────────
export const MolduraPublica: React.FC<{
  tom: Tom;
  progresso?: number | null;
  /** `inicio` ancora o conteúdo no alto (abertura); `centro` centraliza. */
  alinhamento?: 'inicio' | 'centro';
  /** Rodapé discreto — selos de segurança, avisos, links. */
  rodape?: React.ReactNode;
  children: React.ReactNode;
}> = ({ tom, progresso, alinhamento = 'centro', rodape, children }) => (
  <div className="ap-anima" style={{ minHeight: '100dvh', background: CHAO, display: 'flex', flexDirection: 'column' }}>
    <Fio tom={tom} progresso={progresso} />
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: alinhamento === 'centro' ? 'center' : 'flex-start',
        gap: 0, width: '100%', maxWidth: 430, margin: '0 auto',
        padding: alinhamento === 'centro' ? '28px 22px' : '38px 22px 20px',
      }}
    >
      {children}
    </div>
    {rodape && (
      <div style={{ flex: '0 0 auto', width: '100%', maxWidth: 430, margin: '0 auto', padding: '0 22px 22px' }}>
        {rodape}
      </div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Tipografia
// ─────────────────────────────────────────────────────────────────────────────
export const Rotulo: React.FC<{ children: React.ReactNode; cor?: string; style?: React.CSSProperties }> = ({
  children, cor = LARANJA, style,
}) => (
  <p style={{
    margin: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: '.2em',
    textTransform: 'uppercase', color: cor, ...style,
  }}>
    {children}
  </p>
);

/** O nome grande da abertura e do fim — a peça que dá voz humana ao fluxo. */
export const NomeGrande: React.FC<{ acima: string; nome: string; style?: React.CSSProperties }> = ({
  acima, nome, style,
}) => (
  <div style={style}>
    <p style={{ margin: 0, fontSize: 17, color: TINTA_3, letterSpacing: '-.2px', lineHeight: 1.2 }}>{acima}</p>
    <h1 style={{
      margin: '2px 0 0', fontSize: 34, fontWeight: 700, letterSpacing: '-1.1px',
      lineHeight: 1.04, color: TINTA, wordBreak: 'break-word',
    }}>
      {nome}
    </h1>
  </div>
);

export const Explicacao: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: TINTA_2, maxWidth: 300, ...style }}>{children}</p>
);

// ─────────────────────────────────────────────────────────────────────────────
// Etiqueta de documento
// ─────────────────────────────────────────────────────────────────────────────
export const EtiquetaDoDocumento: React.FC<{ nome: string; principal?: boolean; style?: React.CSSProperties }> = ({
  nome, principal = true, style,
}) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999,
    background: principal ? '#fff7ed' : '#f1f5f9',
    border: `1px solid ${principal ? '#fed7aa' : '#e2e8f0'}`,
    maxWidth: '100%', ...style,
  }}>
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke={principal ? LARANJA : TINTA_3}
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
    <span style={{
      fontSize: 11.5, fontWeight: 500, color: principal ? '#c2410c' : TINTA_2,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {nome}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// O cartão de prova.
//
// É a peça central do redesenho: mostra à pessoa a PRÓPRIA prova que ela acabou
// de produzir — a selfie, o traço do dedo dela, onde estava e em que aparelho.
// Aparece duas vezes, e é de propósito: na conferência (com a varredura por
// cima, dizendo "é isto que estamos analisando") e no comprovante (com o selo,
// dizendo "é isto que ficou registrado"). Ver a espera deixa de ser abstrata.
//
// Tudo aqui é dado real que a página já tem em mãos. Nada é decorativo, e cada
// pedaço some quando o dado não existe: em documento de "só assinatura" não há
// selfie, e o lugar dela vira a inicial do nome.
// ─────────────────────────────────────────────────────────────────────────────
export const CartaoDeProva: React.FC<{
  nome: string;
  cpf?: string | null;
  canal?: CanalDeIdentidade;
  /** dataURL da captura facial. Ausente quando o método não pede selfie. */
  selfie?: string | null;
  /** dataURL do traço desenhado no canvas — o mesmo que vai para o documento. */
  assinatura?: string | null;
  local?: { lat: number; lng: number } | null;
  aparelho?: string;
  instante?: string;
  /** Liga a varredura laranja: "estamos analisando isto agora". */
  conferindo?: boolean;
  /** Carimba o selo verde no canto: "isto ficou registrado". */
  selado?: boolean;
  style?: React.CSSProperties;
}> = ({ nome, cpf, canal = null, selfie, assinatura, local, aparelho, instante, conferindo, selado, style }) => {
  const cpfMascarado = mascararCpf(cpf);
  const coordenadas = formatarCoordenadas(local);
  const inicial = (nome || '?').trim().charAt(0).toUpperCase();

  return (
    <div style={{
      position: 'relative', width: '100%', borderRadius: 15, overflow: 'hidden',
      background: '#fff', border: `1px solid ${LINHA}`,
      boxShadow: '0 14px 32px -22px rgba(15,23,42,.45)', ...style,
    }}>
      {conferindo && (
        <div
          aria-hidden
          style={{
            position: 'absolute', left: 0, right: 0, top: 0, height: 52, zIndex: 2, pointerEvents: 'none',
            background: 'linear-gradient(180deg,rgba(249,115,22,0),rgba(249,115,22,.22),rgba(249,115,22,0))',
            animation: 'ap-varre 1.5s ease-in-out infinite',
          }}
        />
      )}

      {selado && (
        <div
          aria-hidden
          style={{
            position: 'absolute', right: -10, top: -10, width: 42, height: 42, borderRadius: 999, zIndex: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            background: 'linear-gradient(135deg,#34d399,#059669)',
            boxShadow: '0 12px 24px -10px rgba(5,150,105,.8)',
            animation: 'ap-selo .6s cubic-bezier(.2,1.4,.4,1) .45s both',
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="3.2"
               strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
        </div>
      )}

      {/* Quem assinou */}
      <div style={{ display: 'flex', gap: 11, padding: '12px 13px 9px', alignItems: 'center' }}>
        <div style={{
          position: 'relative', width: 46, height: 60, borderRadius: 9, flex: '0 0 auto', overflow: 'hidden',
          background: 'linear-gradient(160deg,#eef2f6,#c7d1dc)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selfie ? (
            <>
              <img src={selfie} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, padding: '1px 0',
                fontSize: 6.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
                textAlign: 'center', color: '#fff', background: 'rgba(15,23,42,.55)',
              }}>
                selfie
              </span>
            </>
          ) : (
            <span style={{ fontSize: 22, fontWeight: 700, color: '#8f9bab' }}>{inicial}</span>
          )}
        </div>

        <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <p style={{
            margin: 0, fontSize: 13, fontWeight: 700, color: TINTA, lineHeight: 1.25,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {nome}
          </p>
          {cpfMascarado && (
            <p style={{ margin: '2px 0 0', fontSize: 10.5, color: TINTA_3, fontVariantNumeric: 'tabular-nums' }}>
              CPF {cpfMascarado}
            </p>
          )}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 5, whiteSpace: 'nowrap',
            padding: '2px 7px', borderRadius: 999, background: '#f0fdf4', border: '1px solid #bbf7d0',
            fontSize: 8, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: VERDE,
          }}>
            <svg viewBox="0 0 24 24" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="3.4">
              <path d="M4 12l5 5L20 6" />
            </svg>
            {rotularCanal(canal)}
          </span>
        </div>
      </div>

      {/* O traço. Entra da esquerda para a direita, como quem redesenha. */}
      {assinatura && (
        <div style={{ padding: '0 13px 6px' }}>
          <img
            src={assinatura}
            alt="Sua assinatura"
            style={{
              display: 'block', width: '100%', height: 52, objectFit: 'contain', objectPosition: 'center',
              animation: 'ap-traco 1.4s ease-out both',
            }}
          />
          <div style={{ height: 1, background: '#e2e8f0' }} />
          <p style={{
            margin: '4px 0 0', fontSize: 7.5, letterSpacing: '.13em', textTransform: 'uppercase',
            color: TINTA_4, textAlign: 'center',
          }}>
            Assinado de próprio punho
          </p>
        </div>
      )}

      {/* Onde, em quê, quando */}
      {(coordenadas || aparelho || instante) && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4, padding: '9px 13px 11px',
          borderTop: `1px dashed ${LINHA}`, background: '#fcfcfb',
        }}>
          {coordenadas && (
            <LinhaDeContexto icone={
              <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z" /><circle cx="12" cy="10" r="2.6" />
              </svg>
            }>
              {coordenadas}
            </LinhaDeContexto>
          )}
          {aparelho && (
            <LinhaDeContexto icone={
              <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.4">
                <rect x="7" y="2" width="10" height="20" rx="2.4" /><path d="M11 18.5h2" />
              </svg>
            }>
              {aparelho}
            </LinhaDeContexto>
          )}
          {instante && (
            <LinhaDeContexto icone={
              <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.4">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
            }>
              {instante}
            </LinhaDeContexto>
          )}
        </div>
      )}
    </div>
  );
};

const LinhaDeContexto: React.FC<{ icone: React.ReactNode; children: React.ReactNode }> = ({ icone, children }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 9.5, color: TINTA_2,
    fontVariantNumeric: 'tabular-nums', textAlign: 'left',
  }}>
    <span style={{ color: TINTA_4, display: 'flex', flex: '0 0 auto' }}>{icone}</span>
    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// O bilhete do protocolo — picotado, para virar print.
// ─────────────────────────────────────────────────────────────────────────────
export const Bilhete: React.FC<{
  rotulo: string;
  codigo: string;
  aoCopiar?: () => void;
  destaque?: boolean;
  style?: React.CSSProperties;
}> = ({ rotulo, codigo, aoCopiar, destaque, style }) => (
  <div style={{
    width: '100%', border: '1px dashed #cbd5e1', background: '#fff', borderRadius: 6,
    overflow: 'hidden', ...style,
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '6px 11px', borderBottom: '1px dashed #cbd5e1', background: '#f8fafc',
    }}>
      <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: TINTA_3 }}>
        {rotulo}
      </span>
      {aoCopiar && (
        <button
          type="button"
          onClick={aoCopiar}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
            padding: 0, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: LARANJA,
          }}
        >
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2"
               strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          Copiar
        </button>
      )}
    </div>
    <div style={{
      padding: destaque ? '11px 11px 12px' : '9px 11px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: destaque ? 19 : 14, fontWeight: 500, letterSpacing: '.09em',
      color: TINTA, textAlign: 'center', wordBreak: 'break-all', lineHeight: 1.25,
    }}>
      {codigo}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Ações
// ─────────────────────────────────────────────────────────────────────────────
export const AcaoPrimaria: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icone?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, onClick, disabled, icone, style }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      minHeight: 46, padding: '12px 16px', borderRadius: 11, border: 'none',
      fontSize: 14, fontWeight: 700, color: '#fff',
      background: 'linear-gradient(135deg,#fb8c3e,#ea5310)',
      boxShadow: '0 12px 26px -12px rgba(234,88,12,.65)',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .62 : 1,
      transition: 'transform .12s ease, opacity .2s ease',
      ...style,
    }}
  >
    {icone}
    {children}
  </button>
);

export const AcaoSecundaria: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  icone?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, onClick, icone, style }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      minHeight: 42, padding: '10px 12px', borderRadius: 10,
      border: '1px solid #e2e8f0', background: '#fff', color: TINTA_2,
      fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
      ...style,
    }}
  >
    {icone}
    {children}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────────
// Tarja de aviso. Existe para uma frase só: "não saia desta página".
// ─────────────────────────────────────────────────────────────────────────────
export const Tarja: React.FC<{ tom: 'atencao' | 'pronto' | 'neutro'; children: React.ReactNode; style?: React.CSSProperties }> = ({
  tom, children, style,
}) => {
  const cores = {
    atencao: { fundo: '#fffbeb', borda: '#fde68a', tinta: '#92400e' },
    pronto: { fundo: '#f0fdf4', borda: '#bbf7d0', tinta: VERDE },
    neutro: { fundo: '#f8fafc', borda: '#e2e8f0', tinta: TINTA_2 },
  }[tom];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9, width: '100%',
      padding: '10px 13px', borderRadius: 11,
      background: cores.fundo, border: `1px solid ${cores.borda}`, ...style,
    }}>
      <span style={{ flex: '0 0 auto', color: cores.tinta, display: 'flex' }}>
        {tom === 'pronto' ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.8"
               strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2"
               strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16.5v.01" /></svg>
        )}
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.35, color: cores.tinta, textAlign: 'left' }}>
        {children}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Rodapé de confiança — os selos que já existiam, agora num lugar só.
// ─────────────────────────────────────────────────────────────────────────────
export const RodapeDeConfianca: React.FC<{ itens?: string[]; alinhamento?: 'inicio' | 'centro' }> = ({
  itens = ['Conexão segura', 'AES-256', 'MP 2.200-2/2001'],
  alinhamento = 'centro',
}) => (
  <div style={{
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 9,
    justifyContent: alinhamento === 'centro' ? 'center' : 'flex-start',
    color: TINTA_3, fontSize: 10,
  }}>
    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4"
         style={{ flex: '0 0 auto' }}>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
    {itens.map((item, i) => (
      <React.Fragment key={item}>
        {i > 0 && <span style={{ width: 3, height: 3, borderRadius: 999, background: '#e2e8f0', flex: '0 0 auto' }} />}
        <span>{item}</span>
      </React.Fragment>
    ))}
  </div>
);

/**
 * "Assine com o dedo" — mostrando, não explicando.
 *
 * O lugar da assinatura mostrava um ícone de caneta e a frase "Assine aqui".
 * Quem nunca assinou pelo celular não sabe o que isso quer dizer: falta o
 * GESTO. Aqui um dedo atravessa o quadro e a rubrica nasce atrás dele, em loop.
 *
 * Some no instante em que a pessoa encosta na tela — quem já entendeu não
 * precisa de professor, e uma animação por baixo do traço de verdade seria
 * ruído em cima do trabalho dela.
 */
export const DemoDoDedo: React.FC<{ duracao?: number }> = ({ duracao = 3.8 }) => (
  <svg
    viewBox="0 0 300 118"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden
    style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      ['--ap-demo-dur' as string]: `${duracao}s`,
      overflow: 'visible', pointerEvents: 'none',
    }}
  >
    <defs>
      {/* Uma rubrica qualquer: nem letra, nem nome de ninguém — só o movimento. */}
      <path
        id="ap-demo-rubrica"
        pathLength="1"
        fill="none"
        d="M30 82C50 24 66 20 72 62c5 36-14 42-8 10C70 40 88 26 98 58c8 26 26 20 38-4 8-17 20-12 26 6 7 22 26 12 40-10 10-16 22-12 28 4 5 14 18 16 30 4"
      />
    </defs>

    <use
      className="ap-demo-traco"
      href="#ap-demo-rubrica"
      stroke="#cbd5e1"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />

    <g className="ap-demo-dedo">
      {/* Auréola + ponto: a leitura universal de "um dedo encostado aqui". */}
      <circle r="13" fill="rgba(234,88,12,.14)" />
      <circle r="5.5" fill="#ea580c" />
      <animateMotion
        dur={`${duracao}s`}
        repeatCount="indefinite"
        calcMode="linear"
        keyPoints="0;1;1"
        keyTimes="0;0.63;1"
      >
        <mpath href="#ap-demo-rubrica" />
      </animateMotion>
    </g>
  </svg>
);

/** Roda pequena de espera — a mesma em toda tela pública. */
export const Roda: React.FC<{ tamanho?: number; cor?: string }> = ({ tamanho = 17, cor = LARANJA }) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" style={{ animation: 'ap-gira 1s linear infinite' }} aria-hidden>
    <circle cx="16" cy="16" r="13" fill="none" stroke="#f1f5f9" strokeWidth="3" />
    <circle cx="16" cy="16" r="13" fill="none" stroke={cor} strokeWidth="3" strokeLinecap="round" strokeDasharray="26 56" />
  </svg>
);
