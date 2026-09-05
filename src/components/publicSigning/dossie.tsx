/**
 * O DOSSIÊ — as peças da página pública de validação.
 *
 * A página de conferência deixou de ser um recibo e virou um dossiê: à
 * esquerda quem participou e o que aconteceu, no meio o documento em si, à
 * direita o que se pode levar embora. Quem chega ali não é o cliente — é um
 * cartório, um banco, o advogado da outra parte, um servidor do INSS. Essa
 * pessoa não quer clicar; quer ver o documento e ver quem assinou, ao mesmo
 * tempo, sem abrir nada.
 *
 * ESCALA. A primeira versão nasceu tímida: tipos de 8,5 a 12,5 px, cartões
 * apertados, tudo cinza-claro. Numa tela de 1440 aquilo lê como nota de
 * rodapé — e a página que precisa dizer "este documento é autêntico" não pode
 * sussurrar. Aqui o corpo é 13, os nomes são 15,5, cada dado tem o seu rótulo,
 * e os cartões respiram. Um dossiê que se lê de longe.
 *
 * As peças vivem aqui, e não dentro da tela, porque a tela já carrega a lógica
 * das seis formas de consulta. Aqui só há aparência — o mesmo idioma claro das
 * telas de assinatura (`./ui`), nunca o tema do sistema operacional de quem lê.
 */
import React from 'react';
import { LINHA, TINTA, TINTA_2, TINTA_3, TINTA_4, VERDE } from './ui';
import {
  detalheDoEvento,
  localizacaoDaAssinatura,
  provaDeIdentidade,
  rotuloDaSituacao,
  rotuloDoEvento,
  situacaoDoSignatario,
  type SignatarioDoDossie,
  type SituacaoDoSignatario,
} from '../../utils/assinaturaPublica';
import type { ConfrontoDoSelo, LadoDoConfronto } from '../../utils/certificadoDoSelo';
import type { StatusIntegridade } from '../../utils/integridadeAssinatura';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * A GRADE DAS TRÊS COLUNAS — e a ordem em que ela desmonta.
 *
 * No celular, empilhar na ordem do código (signatários → documento → opções)
 * deixaria o documento abaixo de uma lista de cartões: quem abre o link no
 * telefone quer VER o documento. Por isso a ordem de leitura é declarada por
 * área, e não pela sequência do JSX — no estreito o meio vem primeiro.
 *
 * Inline style não faz media query, então esta é a única folha de estilo desta
 * tela. O prefixo `ap-` é o mesmo das telas de assinatura.
 */
(() => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ap-dossie-estilos')) return;
  const style = document.createElement('style');
  style.id = 'ap-dossie-estilos';
  style.textContent = `
    .ap-dossie {
      display: grid; gap: 20px; align-items: start;
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "meio" "lado" "opcoes";
    }
    .ap-dossie-lado { grid-area: lado }
    .ap-dossie-meio { grid-area: meio; min-width: 0 }
    .ap-dossie-opcoes { grid-area: opcoes }
    .ap-dossie-visor { height: 64vh; min-height: 400px }
    @media (min-width: 940px) {
      .ap-dossie {
        grid-template-columns: 344px minmax(0, 1fr);
        grid-template-areas: "lado meio" "opcoes meio";
      }
      .ap-dossie-visor { height: 80vh; min-height: 620px }
    }
    @media (min-width: 1280px) {
      .ap-dossie {
        grid-template-columns: 344px minmax(0, 1fr) 286px;
        grid-template-areas: "lado meio opcoes";
      }
      .ap-dossie-lado, .ap-dossie-opcoes { position: sticky; top: 18px }
      .ap-dossie-lado { max-height: calc(100dvh - 36px); overflow: auto }
    }
    /* Resposta ao ponteiro. Sem isto a coluna da direita parece uma tabela
       morta, e nada indica que aquelas linhas são botões. */
    .ap-dossie-opcao:hover:not(:disabled) { background: #fff7ed }
    .ap-dossie-arquivo:hover { background: #fffdfb }
  `;
  document.head.appendChild(style);
})();

/** Cartão branco — a unidade de todas as três colunas. */
export const Painel: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      background: '#fff',
      border: `1px solid ${LINHA}`,
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 1px 2px rgba(15,23,42,.04), 0 14px 30px -24px rgba(15,23,42,.3)',
      ...style,
    }}
  >
    {children}
  </div>
);

export const TituloDoPainel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children, style,
}) => (
  <span
    style={{
      display: 'block',
      padding: '15px 18px 10px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '.16em',
      textTransform: 'uppercase',
      color: TINTA_3,
      ...style,
    }}
  >
    {children}
  </span>
);

/** As abas do painel da esquerda: quem assinou × o que aconteceu. */
export const Abas: React.FC<{
  itens: readonly { chave: string; rotulo: string; contagem?: number }[];
  ativa: string;
  aoTrocar: (chave: string) => void;
}> = ({ itens, ativa, aoTrocar }) => (
  <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${LINHA}`, padding: '0 8px' }}>
    {itens.map((item) => {
      const selecionada = item.chave === ativa;
      return (
        <button
          key={item.chave}
          type="button"
          onClick={() => aoTrocar(item.chave)}
          style={{
            position: 'relative',
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '15px 12px 14px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 13.5,
            fontWeight: 700,
            letterSpacing: '-.15px',
            color: selecionada ? '#c2410c' : TINTA_2,
          }}
        >
          {item.rotulo}
          {typeof item.contagem === 'number' && (
            <span style={{
              minWidth: 19, padding: '1px 6px', borderRadius: 999,
              fontSize: 10.5, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
              background: selecionada ? '#ffedd5' : '#f1f5f9',
              color: selecionada ? '#9a3412' : TINTA_2,
            }}>
              {item.contagem}
            </span>
          )}
          <span
            aria-hidden
            style={{
              position: 'absolute', left: 10, right: 10, bottom: -1, height: 2.5, borderRadius: 3,
              background: selecionada ? '#ea580c' : 'transparent',
            }}
          />
        </button>
      );
    })}
  </div>
);

/**
 * Uma linha de dado: o rótulo pequeno em cima, o valor legível embaixo.
 *
 * Antes era ícone + texto de 10,5 px na mesma linha, tudo cinza — o leitor
 * tinha de adivinhar o que cada linha era pelo formato do valor, e um IP ao
 * lado de um CPF vira uma sopa de números. Nomear o dado custa uma linha e
 * devolve a leitura.
 */
const Dado: React.FC<{
  rotulo: string;
  children: React.ReactNode;
  monoespacado?: boolean;
}> = ({ rotulo, children, monoespacado }) => (
  <div style={{ marginTop: 11 }}>
    <span style={{
      display: 'block', fontSize: 9.5, fontWeight: 700, letterSpacing: '.13em',
      textTransform: 'uppercase', color: TINTA_4,
    }}>
      {rotulo}
    </span>
    <span
      style={{
        display: 'block', marginTop: 2.5, fontSize: 13, lineHeight: 1.45, color: TINTA_2,
        overflowWrap: 'anywhere', fontFamily: monoespacado ? MONO : undefined,
        letterSpacing: monoespacado ? '-.2px' : undefined,
      }}
    >
      {children}
    </span>
  </div>
);

const CORES_DA_SITUACAO: Record<SituacaoDoSignatario, { fundo: string; tinta: string; borda: string }> = {
  assinou:    { fundo: '#ecfdf5', tinta: '#047857', borda: '#a7f3d0' },
  recusou:    { fundo: '#fef2f2', tinta: '#b91c1c', borda: '#fecaca' },
  visualizou: { fundo: '#fffbeb', tinta: '#b45309', borda: '#fde68a' },
  aguardando: { fundo: '#f8fafc', tinta: '#64748b', borda: '#e2e8f0' },
};

export const SeloDaSituacao: React.FC<{ situacao: SituacaoDoSignatario }> = ({ situacao }) => {
  const cor = CORES_DA_SITUACAO[situacao];
  return (
    <span
      style={{
        flex: '0 0 auto', padding: '4px 10px', borderRadius: 999,
        border: `1px solid ${cor.borda}`, background: cor.fundo, color: cor.tinta,
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap',
      }}
    >
      {rotuloDaSituacao(situacao)}
    </span>
  );
};

/** A moldura circular com as iniciais — em vez de uma foto que não temos. */
const Iniciais: React.FC<{ nome: string; tom?: 'emissor' | 'signatario' }> = ({ nome, tom = 'signatario' }) => {
  const letras = String(nome || '?')
    .trim()
    .split(/\s+/)
    .filter((parte) => parte.length > 1)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join('') || '?';
  return (
    <span
      aria-hidden
      style={{
        flex: '0 0 auto', width: 40, height: 40, borderRadius: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, letterSpacing: '.02em',
        color: tom === 'emissor' ? '#9a3412' : '#334155',
        background: tom === 'emissor' ? '#ffedd5' : '#f1f5f9',
        border: `1px solid ${tom === 'emissor' ? '#fed7aa' : '#e2e8f0'}`,
      }}
    >
      {letras}
    </span>
  );
};

const dataLonga = (valor: string | null | undefined): string => {
  if (!valor) return '';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/** Quem emitiu o documento — o escritório, não o cliente. */
export const CartaoDoEmissor: React.FC<{
  nome: string;
  email?: string | null;
  criadoEm?: string | null;
}> = ({ nome, email, criadoEm }) => (
  <div style={{ padding: '16px 18px', borderBottom: `1px solid ${LINHA}`, background: '#fffdfb' }}>
    <span style={{
      display: 'block', marginBottom: 11, fontSize: 9.5, fontWeight: 700,
      letterSpacing: '.16em', textTransform: 'uppercase', color: '#c2410c',
    }}>
      Emitido por
    </span>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Iniciais nome={nome} tom="emissor" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: TINTA, lineHeight: 1.25 }}>
          {nome}
        </span>
        {email && (
          <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: TINTA_2, overflowWrap: 'anywhere' }}>
            {email}
          </span>
        )}
      </div>
    </div>
    {criadoEm && (
      <span style={{ display: 'block', marginTop: 11, fontSize: 12, color: TINTA_3 }}>
        Criou o documento em {dataLonga(criadoEm)}
      </span>
    )}
  </div>
);

/** O que foi COLETADO na assinatura — um selo por prova, não uma frase. */
const SeloDaProva: React.FC<{ rotulo: string }> = ({ rotulo }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 9px', borderRadius: 8,
    background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857',
    fontSize: 11, fontWeight: 700,
  }}>
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.4"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12l5 5L20 6" /></svg>
    {rotulo}
  </span>
);

/**
 * O cartão de cada signatário.
 *
 * CPF, endereço e IP aparecem inteiros. Numa página de conferência mascarar é
 * enfraquecer a prova: quem está do outro lado precisa CASAR o dado com o
 * documento que tem em mãos, e "•••.093.791-••" não casa com nada.
 *
 * O que ENTRA no cartão é só o que participou da assinatura — ver
 * `provaDeIdentidade` e `telefoneQueAutenticou`. O telefone do cadastro,
 * impresso ao lado de "código por e-mail", lia como um segundo canal de
 * autenticação que não existiu.
 */
export const CartaoDeSignatario: React.FC<{
  signatario: SignatarioDoDossie;
  ultimo?: boolean;
}> = ({ signatario, ultimo }) => {
  const situacao = situacaoDoSignatario(signatario);
  const nome = String(signatario.name || 'Signatário').trim();
  const prova = provaDeIdentidade(signatario);
  const local = localizacaoDaAssinatura(signatario.signer_geolocation);
  const quando = signatario.signed_at || signatario.refused_at || signatario.viewed_at;

  const provas = ([
    signatario.has_signature_image ? 'Assinatura' : '',
    signatario.has_facial_image ? 'Selfie' : '',
    signatario.has_document_image ? 'Documento de identidade' : '',
  ] as const).filter(Boolean) as string[];

  const momento =
    situacao === 'assinou' ? 'Assinou em'
    : situacao === 'recusou' ? 'Recusou em'
    : situacao === 'visualizou' ? 'Abriu em'
    : '';

  return (
    <div style={{ padding: 18, borderBottom: ultimo ? 'none' : `1px solid ${LINHA}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Iniciais nome={nome} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{
            display: 'block', fontSize: 15.5, fontWeight: 700, color: TINTA,
            lineHeight: 1.25, letterSpacing: '-.2px',
          }}>
            {nome}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
            <SeloDaSituacao situacao={situacao} />
            {signatario.role && (
              <span style={{ fontSize: 11.5, color: TINTA_3 }}>{signatario.role}</span>
            )}
          </span>
        </div>
      </div>

      {signatario.cpf && <Dado rotulo="CPF" monoespacado>{signatario.cpf}</Dado>}

      {/* E-MAIL OU TELEFONE — o que provou a identidade, um só, com o nome do
          que provou. Ver `provaDeIdentidade`. */}
      {prova.valor && <Dado rotulo={prova.rotulo}>{prova.valor}</Dado>}

      {momento && quando && (
        <Dado rotulo={momento}>
          {dataLonga(quando)}
          {situacao === 'visualizou' && <span style={{ color: TINTA_3 }}> — ainda não assinou</span>}
        </Dado>
      )}
      {situacao === 'aguardando' && <Dado rotulo="Situação">Ainda não abriu o documento</Dado>}

      {signatario.signer_ip && <Dado rotulo="Endereço IP" monoespacado>{signatario.signer_ip}</Dado>}

      {local.texto && (
        <Dado rotulo="Localização" monoespacado>
          <a
            href={local.mapa}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#c2410c', textDecoration: 'none', fontWeight: 600 }}
          >
            {local.texto} ↗
          </a>
        </Dado>
      )}

      {provas.length > 0 && (
        <div style={{ marginTop: 13 }}>
          <span style={{
            display: 'block', marginBottom: 7, fontSize: 9.5, fontWeight: 700,
            letterSpacing: '.13em', textTransform: 'uppercase', color: TINTA_4,
          }}>
            Coletado na assinatura
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {provas.map((item) => <SeloDaProva key={item} rotulo={item} />)}
          </div>
        </div>
      )}

      {signatario.refusal_reason && (
        <div style={{
          marginTop: 13, padding: '10px 12px', borderRadius: 10,
          background: '#fef2f2', border: '1px solid #fecaca',
          fontSize: 12, lineHeight: 1.5, color: '#b91c1c',
        }}>
          <b>Motivo da recusa:</b> {signatario.refusal_reason}
        </div>
      )}

      {signatario.verification_hash && (
        <Dado rotulo="Código de verificação" monoespacado>{signatario.verification_hash}</Dado>
      )}
    </div>
  );
};

const COR_DO_EVENTO: Record<string, string> = {
  created: '#94a3b8',
  sent: '#0ea5e9',
  viewed: '#f59e0b',
  signed: '#059669',
  refused: '#e11d48',
  finalized: '#059669',
  finalization_failed: '#e11d48',
  integrity_verified: '#0ea5e9',
  reminder_sent: '#f59e0b',
  expired: '#e11d48',
};

/** A trilha de auditoria, em ordem cronológica. */
export const ListaDoHistorico: React.FC<{
  eventos: readonly {
    action?: string | null;
    description?: string | null;
    created_at?: string | null;
    ip_address?: string | null;
  }[];
}> = ({ eventos }) => {
  if (!eventos.length) {
    return (
      <p style={{ margin: 0, padding: 18, fontSize: 12.5, lineHeight: 1.6, color: TINTA_3 }}>
        Este registro não tem trilha de auditoria detalhada — foi criado antes de o
        acompanhamento evento a evento existir.
      </p>
    );
  }
  return (
    <div style={{ padding: 18 }}>
      {eventos.map((evento, indice) => {
        const cor = COR_DO_EVENTO[String(evento.action || '')] || TINTA_3;
        const ultimo = indice === eventos.length - 1;
        const detalhe = detalheDoEvento(evento.action, evento.description);
        return (
          <div key={`${evento.created_at}-${indice}`} style={{ display: 'flex', gap: 12 }}>
            {/* O fio da linha do tempo: bolinha + traço até o próximo evento. */}
            <span style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{
                width: 9, height: 9, borderRadius: 999, marginTop: 5,
                background: cor, boxShadow: `0 0 0 4px ${cor}1f`,
              }} />
              {!ultimo && <span style={{ flex: 1, width: 1.5, background: LINHA, marginTop: 4 }} />}
            </span>
            <div style={{ minWidth: 0, flex: 1, paddingBottom: ultimo ? 0 : 18 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: TINTA, lineHeight: 1.3 }}>
                {rotuloDoEvento(evento.action)}
              </span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: TINTA_3 }}>
                {dataLonga(evento.created_at)}
                {evento.ip_address ? ` · IP ${evento.ip_address}` : ''}
              </span>
              {detalhe && (
                <span style={{
                  display: 'block', marginTop: 5, fontSize: 12.5, lineHeight: 1.55,
                  color: TINTA_2, overflowWrap: 'anywhere',
                }}>
                  {detalhe}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * A faixa do topo da coluna do meio: "Assinado por 1 de 1 signatário".
 *
 * Verde só quando TODOS assinaram. Um envelope com 1 de 2 pintado de verde
 * anunciaria um documento fechado que ainda espera alguém.
 */
export const FaixaDaContagem: React.FC<{ texto: string; completo: boolean }> = ({ texto, completo }) => (
  <div
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11,
      padding: '16px 20px', borderRadius: 14,
      background: completo
        ? 'linear-gradient(180deg,#f2fdf7,#ecfdf5)'
        : 'linear-gradient(180deg,#fffdf4,#fffbeb)',
      border: `1px solid ${completo ? '#a7f3d0' : '#fde68a'}`,
      color: completo ? '#047857' : '#b45309',
      fontSize: 15.5, fontWeight: 700, letterSpacing: '-.2px',
    }}
  >
    <span style={{
      flex: '0 0 auto', width: 27, height: 27, borderRadius: 999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      background: completo
        ? 'linear-gradient(135deg,#34d399,#059669)'
        : 'linear-gradient(135deg,#fbbf24,#d97706)',
      boxShadow: `0 9px 20px -11px ${completo ? 'rgba(5,150,105,.95)' : 'rgba(217,119,6,.95)'}`,
    }}>
      {completo ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="3.4"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12l5 5L20 6" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.8"
             strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      )}
    </span>
    {texto}
  </div>
);

/**
 * O par de chips do cabeçalho: a impressão digital e o identificador.
 *
 * O hash vem inteiro e quebra em duas linhas de propósito — cortado com
 * reticências ele não serve nem para conferir nem para copiar, que são as duas
 * únicas coisas que se fazem com ele.
 */
export const ChipDeCodigo: React.FC<{
  rotulo: string;
  valor: string;
  icone: React.ReactNode;
  aoCopiar?: () => void;
  copiado?: boolean;
}> = ({ rotulo, valor, icone, aoCopiar, copiado }) => (
  <div
    style={{
      flex: '1 1 280px', minWidth: 0, position: 'relative',
      padding: '13px 48px 13px 15px', borderRadius: 13,
      background: '#fff', border: `1px solid ${LINHA}`,
    }}
  >
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: TINTA_2 }}>
      {icone}
      <span style={{ fontSize: 11.5, fontWeight: 700 }}>{rotulo}</span>
    </span>
    <code style={{
      display: 'block', marginTop: 6, fontFamily: MONO, fontSize: 11.5,
      lineHeight: 1.65, letterSpacing: '-.2px', color: TINTA, wordBreak: 'break-all',
    }}>
      {valor}
    </code>
    {aoCopiar && (
      <button
        type="button"
        onClick={aoCopiar}
        aria-label={`Copiar ${rotulo}`}
        style={{
          position: 'absolute', top: 10, right: 10, width: 30, height: 30,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${LINHA}`, borderRadius: 9, background: '#f8fafc',
          color: copiado ? VERDE : TINTA_3, cursor: 'pointer',
        }}
      >
        {copiado ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12l5 5L20 6" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2"
               strokeLinecap="round" aria-hidden><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
        )}
      </button>
    )}
  </div>
);

/** Uma opção da coluna da direita: ícone, título e a frase que explica. */
export const Opcao: React.FC<{
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  onClick: () => void;
  desabilitado?: boolean;
}> = ({ icone, titulo, descricao, onClick, desabilitado }) => (
  <button
    type="button"
    className="ap-dossie-opcao"
    onClick={onClick}
    disabled={desabilitado}
    style={{
      display: 'flex', gap: 12, width: '100%', textAlign: 'left', alignItems: 'flex-start',
      padding: '15px 16px', border: 'none', borderBottom: `1px solid ${LINHA}`,
      background: 'transparent', cursor: desabilitado ? 'default' : 'pointer',
      opacity: desabilitado ? 0.45 : 1, transition: 'background 120ms',
    }}
  >
    <span style={{
      flex: '0 0 auto', width: 31, height: 31, borderRadius: 9,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#fff7ed', border: '1px solid #fed7aa', color: '#ea580c',
    }}>
      {icone}
    </span>
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: TINTA, lineHeight: 1.3 }}>
        {titulo}
      </span>
      <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, lineHeight: 1.5, color: TINTA_3 }}>
        {descricao}
      </span>
    </span>
  </button>
);

/**
 * O SELO DE INTEGRIDADE — a prova que existia e não era mostrada.
 *
 * O PDF passou a carregar uma assinatura criptográfica, e até aqui a única
 * forma de descobrir isso era abrir o arquivo no Adobe. Fazer a prova e não
 * mostrá-la é metade do trabalho.
 *
 * O cartão foi ENXUGANDO a pedido: primeiro saiu o parágrafo de ressalvas,
 * depois o rótulo sobre a ICP-Brasil e o botão de baixar o certificado. Numa
 * página cuja função é transmitir confiança, aviso e opção demais faziam o
 * contrário.
 *
 * O que NÃO pode sair é a impressão digital: sem ela o cartão afirmaria
 * "assinatura criptográfica" sem dar como conferir de quem ela é, e a página
 * inteira existe para permitir conferência, não para pedir fé.
 *
 * ── O QUE MUDOU: DE AFIRMAÇÃO PARA CONFRONTO ──────────────────────────────
 *
 * O bloco do certificado trazia duas frases escritas por nós: o nome do selo,
 * digitado no JSX, e a impressão digital, copiada de uma constante. Quem lê a
 * página não tinha como saber se aquele nome é o nome que está DENTRO do
 * certificado, nem se o certificado que assinou o PDF é o mesmo que
 * publicamos. Era pedir fé, de novo, no meio da página que existe para não
 * pedir fé.
 *
 * Agora os dois campos são LIDOS (ver `utils/certificadoDoSelo.ts`): o nome, o
 * emissor, a série e a validade saem do próprio certificado, e as duas
 * impressões — a do arquivo publicado em `/selo-de-integridade.crt` e a do
 * certificado que viaja no PKCS#7 do PDF — aparecem uma sobre a outra, com o
 * veredicto. É o confronto, e ele acontece no navegador de quem confere.
 *
 * A REGRA DE HONESTIDADE DO VEREDICTO. `confere` só pode aparecer quando os
 * DOIS lados foram lidos. Sem os bytes do PDF (consulta por código, ou CORS
 * barrando o download) o cartão mostra um lado só e diz que mostrou um lado
 * só. E, mesmo com os dois, o que se afirma é estreito: que o PDF foi selado
 * com o certificado que publicamos — a matemática da assinatura continua sendo
 * conferida pelo leitor de PDF, e o texto acima é que promete isso.
 */

/** Data curta a partir do ISO do certificado. Vazio some, nunca vira "Invalid". */
const dataDoCertificado = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
};

/** A linha de identificação do certificado, transcrita campo a campo. */
const LinhaDoConfronto: React.FC<{
  rotulo: string;
  impressao: string;
  destaque: boolean;
}> = ({ rotulo, impressao, destaque }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4 }}>
    <span style={{
      // O rótulo não quebra, e a coluna tem largura fixa: é isso que deixa as
      // duas impressões começando na MESMA coluna, uma sobre a outra. Sem o
      // alinhamento não há confronto — há dois códigos soltos.
      flex: '0 0 92px', whiteSpace: 'nowrap', fontSize: 9, fontWeight: 700, letterSpacing: '.07em',
      textTransform: 'uppercase', color: TINTA_3,
    }}>
      {rotulo}
    </span>
    <code style={{
      minWidth: 0, flex: 1, fontFamily: MONO, fontSize: 9.5, lineHeight: 1.55,
      color: destaque ? TINTA_2 : TINTA_3, wordBreak: 'break-all',
    }}>
      {impressao}
    </code>
  </div>
);

export const SeloDeIntegridade: React.FC<{
  seladoEm?: string | null;
  total: number;
  selados: number;
  /** A impressão da constante — só entra quando o certificado não pôde ser lido. */
  impressao: string;
  /** O confronto, quando já houver: `null` enquanto carrega. */
  confronto?: ConfrontoDoSelo | null;
  /** Comparação entre o PDF servido agora e o SHA-256 imutável do registro. */
  integridade?: {
    status: StatusIntegridade;
    hashRegistrado: string | null;
    hashAtual: string | null;
  } | null;
  /** O arquivo público do certificado, para quem quiser conferir por fora. */
  urlDoCertificado?: string;
}> = ({ seladoEm, total, selados, impressao, confronto, integridade, urlDoCertificado }) => {
  const completo = total > 0 && selados >= total;
  const veredicto = confronto?.veredicto ?? 'indisponivel';
  const certificadoDiverge = veredicto === 'diverge';
  const arquivoDiverge = integridade?.status === 'mismatch';
  const conferindoArquivo = integridade?.status === 'checking';
  const arquivoInconclusivo = integridade?.status === 'unavailable';
  const arquivoConfere = integridade?.status === 'valid';
  const diverge = certificadoDiverge || arquivoDiverge;
  // Na divergência o cartão inteiro muda de tom: é a única coisa nesta página
  // que pode significar documento adulterado, e ela não pode passar como um
  // detalhe cinza dentro de um cartão verde.
  const tom = diverge
    ? 'alerta'
    : conferindoArquivo || arquivoInconclusivo
      ? 'parcial'
      : completo ? 'pronto' : 'parcial';
  const fundo = tom === 'alerta'
    ? '#fef2f2'
    : tom === 'pronto' ? 'linear-gradient(180deg,#f8fdfa,#f4fbf7)' : '#fffbeb';
  const borda = tom === 'alerta' ? '#fecaca' : tom === 'pronto' ? '#bbf7d0' : '#fde68a';
  const tinta = tom === 'alerta' ? '#b91c1c' : tom === 'pronto' ? '#047857' : '#b45309';
  const escudo = tom === 'alerta'
    ? 'linear-gradient(135deg,#f87171,#dc2626)'
    : tom === 'pronto'
      ? 'linear-gradient(135deg,#34d399,#059669)'
      : 'linear-gradient(135deg,#fbbf24,#d97706)';

  /* O lado que dá o CARTÃO DE IDENTIDADE do selo. O do documento tem
     precedência: é o certificado que está no arquivo que a pessoa tem em mãos,
     e é dele que o nome exibido deve sair. O do servidor só aparece sozinho
     quando o do documento não pôde ser lido. */
  const identidade: LadoDoConfronto | null = confronto?.documento || confronto?.servidor || null;
  // Organização antes de unidade: "Jurius · Validador Publico" lê como
  // "quem, e qual setor"; o inverso lê como uma sigla solta seguida de nome.
  const local = [identidade?.organizacao, identidade?.unidade].filter(Boolean).join(' · ');
  const de = dataDoCertificado(identidade?.validoDe || '');
  const ate = dataDoCertificado(identidade?.validoAte || '');
  const tituloDoSelo = arquivoDiverge
    ? 'Documento violado — conteúdo alterado'
    : certificadoDiverge
      ? 'O certificado deste arquivo não é o nosso'
      : conferindoArquivo
        ? 'Conferindo a integridade do arquivo'
        : arquivoInconclusivo
          ? 'Integridade do arquivo inconclusiva'
          : completo
            ? 'Este arquivo carrega assinatura criptográfica'
            : `Selo parcial — ${selados} de ${total} arquivos`;

  return (
    <div style={{
      marginTop: 14, padding: '15px 17px', borderRadius: 14,
      background: fundo, border: `1px solid ${borda}`,
    }}>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <span style={{
          flex: '0 0 auto', width: 30, height: 30, borderRadius: 9, marginTop: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          background: escudo,
        }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
               strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6z" />
            {diverge ? <path d="M12 8v4M12 16h.01" /> : <path d="M9 12l2 2 4-4" />}
          </svg>
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{
            display: 'block', fontSize: 14, fontWeight: 700, letterSpacing: '-.2px', color: tinta,
          }}>
            {tituloDoSelo}
          </span>
          <p style={{ margin: '5px 0 0', fontSize: 12.5, lineHeight: 1.6, color: TINTA_2 }}>
            {arquivoDiverge ? (
              <>
                O SHA-256 do PDF servido agora é <strong>diferente</strong> do hash registrado
                quando ele foi assinado. O arquivo sofreu alteração posterior e não deve ser aceito.
              </>
            ) : certificadoDiverge ? (
              <>
                O PDF traz assinatura digital, mas ela foi feita com um certificado
                <strong> diferente</strong> do que o Jurius publica. Confira as duas impressões
                abaixo e abra o arquivo num leitor de PDF antes de aceitá-lo.
              </>
            ) : conferindoArquivo ? (
              <>Aguarde enquanto calculamos o SHA-256 do PDF armazenado e confrontamos com o registro.</>
            ) : arquivoInconclusivo ? (
              <>
                O registro foi localizado, mas não foi possível ler os bytes do PDF para confirmar
                sua integridade. Este estado não deve ser tratado como documento íntegro.
              </>
            ) : (
              <>
                O PDF traz uma assinatura digital embutida.
                {arquivoConfere ? ' O SHA-256 dos bytes servidos confere com o registro.' : ''}
                {' '}Alterações posteriores são detectadas por leitores compatíveis com assinaturas
                digitais, sem depender desta página.
                {seladoEm ? ` Selado em ${dataLonga(seladoEm)}.` : ''}
              </>
            )}
          </p>

          <div style={{
            marginTop: 11, padding: '10px 12px', borderRadius: 10,
            background: '#fff', border: `1px solid ${LINHA}`,
          }}>
            <span style={{
              display: 'block', fontSize: 9.5, fontWeight: 700, letterSpacing: '.13em',
              textTransform: 'uppercase', color: TINTA_4,
            }}>
              Certificado que selou
            </span>

            {/* O NOME, transcrito do certificado. Sem certificado legível, o
                rótulo do sistema — nunca uma frase que finja ter sido lida. */}
            <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, fontWeight: 600, color: TINTA }}>
              {identidade?.nome || 'Jurius — Selo de Integridade'}
            </span>
            {identidade && (
              <span style={{ display: 'block', marginTop: 2, fontSize: 11, lineHeight: 1.5, color: TINTA_3 }}>
                {local}
                {identidade.autoassinado
                  ? ' · Emitido por si mesmo'
                  : identidade.emissor ? ` · Emitido por ${identidade.emissor}` : ''}
                {de && ate ? ` · Válido de ${de} a ${ate}` : ''}
              </span>
            )}

            {/* ── O CONFRONTO ────────────────────────────────────────────── */}
            <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px dashed ${LINHA}` }}>
              {confronto?.documento && (
                <LinhaDoConfronto
                  rotulo="No documento"
                  impressao={confronto.documento.impressao}
                  destaque
                />
              )}
              <LinhaDoConfronto
                rotulo={confronto?.documento ? 'No servidor' : 'SHA-256'}
                impressao={confronto?.servidor?.impressao || impressao}
                destaque={!confronto?.documento}
              />

              <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.55, color: diverge ? '#b91c1c' : TINTA_2 }}>
                {veredicto === 'confere' && arquivoDiverge && (
                  <>
                    <strong style={{ color: '#b91c1c' }}>Os certificados conferem, mas o arquivo não.</strong>{' '}
                    A impressão identifica o certificado embutido; ela não anula a divergência do
                    SHA-256 do PDF.
                  </>
                )}
                {veredicto === 'confere' && !arquivoDiverge && (
                  <>
                    <strong style={{ color: VERDE }}>As duas impressões conferem.</strong>{' '}
                    O certificado embutido neste PDF é, byte a byte, o mesmo que o Jurius publica.
                    {arquivoConfere ? ' O SHA-256 do arquivo também confere com o registro.' : ''}
                  </>
                )}
                {veredicto === 'diverge' && (
                  <><strong>As impressões não conferem.</strong> O certificado dentro do arquivo
                    não é o que o Jurius publica.</>
                )}
                {veredicto !== 'confere' && veredicto !== 'diverge' && (
                  <>
                    Esta é a impressão do certificado que o Jurius publica. Para confrontá-la com a
                    do certificado que está <em>dentro</em> do arquivo, abra o PDF num leitor e
                    consulte as propriedades da assinatura.
                  </>
                )}
                {urlDoCertificado && (
                  <>
                    {' '}
                    <a
                      href={urlDoCertificado}
                      download
                      style={{ color: TINTA_2, textDecoration: 'underline', whiteSpace: 'nowrap' }}
                    >
                      Baixar o certificado
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
