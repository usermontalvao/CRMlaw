/**
 * O comprovante — a tela que fica depois de assinar.
 *
 * A versão anterior era um certificado escuro: fundo #0B1120 com grade, painel
 * com monograma serifado, título em serifa itálica. Bonito, e um terceiro
 * idioma: a pessoa atravessava duas telas claras sem serifa nenhuma e caía
 * nisso. Pior, a prova que ela acabou de produzir sumia da vista bem na hora em
 * que ela mais gostaria de vê-la registrada.
 *
 * Este é um recibo. Picotado em cima e embaixo, protocolo grande em mono,
 * selfie e traço lado a lado, e as quatro linhas que alguém vai querer conferir
 * depois. Foi desenhado para virar print no álbum do celular — que é o que as
 * pessoas fazem com comprovante, quer a gente projete para isso ou não.
 *
 * O que NÃO mudou, de propósito: o protocolo do envelope continua sendo o herói
 * (é ele que valida), a lista por documento do modelo `per_document` continua
 * inteira, e todas as ações antigas continuam alcançáveis.
 */
import React from 'react';
import {
  type CanalDeIdentidade,
  formatarCoordenadas,
  mascararCpf,
  nomeDoCanal,
} from '../../utils/assinaturaPublica';
import {
  AcaoPrimaria,
  AcaoSecundaria,
  LARANJA,
  MolduraPublica,
  Roda,
  RodapeDeConfianca,
  TINTA,
  TINTA_2,
  TINTA_3,
  TINTA_4,
  VERDE,
  sobe,
} from './ui';

export interface DocumentoAssinado {
  documentKey: string;
  displayName: string;
  verificationCode: string;
  url?: string | null;
}

const Picote: React.FC<{ lado: 'topo' | 'base' }> = ({ lado }) => (
  <div
    aria-hidden
    style={{
      position: 'absolute', left: 0, right: 0, height: 7,
      [lado === 'topo' ? 'top' : 'bottom']: -6,
      background: 'radial-gradient(circle at 4px 0, transparent 0 4px, #fff 4px)',
      backgroundSize: '8px 7px',
      transform: lado === 'topo' ? 'rotate(180deg)' : undefined,
    } as React.CSSProperties}
  />
);

const Divisor: React.FC = () => (
  <div
    aria-hidden
    style={{
      height: 1, margin: '11px 0',
      background: 'repeating-linear-gradient(to right,#e2e8f0 0 3px,transparent 3px 6px)',
    }}
  />
);

const Linha: React.FC<{ chave: string; children: React.ReactNode }> = ({ chave, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginTop: 5 }}>
    <span style={{
      flex: '0 0 auto', fontSize: 8, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase', color: TINTA_4,
    }}>
      {chave}
    </span>
    <span style={{
      minWidth: 0, fontSize: 10.5, color: TINTA_2, textAlign: 'right',
      fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  </div>
);

const TelaDeComprovante: React.FC<{
  nome: string;
  cpf?: string | null;
  canal?: CanalDeIdentidade;
  selfie?: string | null;
  assinatura?: string | null;
  local?: { lat: number; lng: number } | null;
  documento?: string | null;
  assinadoEm?: string | null;
  protocolo: string;
  documentosAssinados: DocumentoAssinado[];
  temArquivoAssinado: boolean;
  abrindo?: boolean;
  /** O compartilhamento faz rede antes de abrir a folha do sistema. */
  compartilhando?: boolean;
  urlDeVerificacao?: string | null;
  aoAbrir: () => void;
  aoCompartilhar: () => void;
  aoCopiarProtocolo: () => void;
  aoAbrirDocumento?: (url: string) => void;
  /** Os Termos que a pessoa aceitou para assinar — precisa continuar alcançável. */
  urlDosTermos?: string | null;
}> = ({
  nome, cpf, canal = null, selfie, assinatura, local, documento, assinadoEm,
  protocolo, documentosAssinados, temArquivoAssinado, abrindo, compartilhando, urlDeVerificacao,
  aoAbrir, aoCompartilhar, aoCopiarProtocolo, aoAbrirDocumento, urlDosTermos,
}) => {
  const coordenadas = formatarCoordenadas(local);
  const cpfMascarado = mascararCpf(cpf);
  const identidade = cpfMascarado ? `${nomeDoCanal(canal)} · CPF ${cpfMascarado}` : nomeDoCanal(canal);

  return (
    <MolduraPublica
      tom="pronto"
      rodape={<RodapeDeConfianca itens={['Conexão segura', 'AES-256', 'MP 2.200-2/2001']} />}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, textAlign: 'center' }}>

        {/*
          O FATO vem primeiro.
          
          A tela abria em "Guarde este comprovante" — uma instrução. Quem acabou
          de assinar quer ouvir que deu certo antes de receber tarefa; sem isso,
          o comprovante parecia um formulário e não uma confirmação.
        */}
        <div style={sobe(0, 0.5)}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 999, marginBottom: 12,
            background: 'linear-gradient(135deg,#34d399,#059669)', color: '#fff',
            boxShadow: '0 12px 26px -12px rgba(5,150,105,.8)',
          }}>
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" strokeWidth="3.2"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 12l5 5L20 6" />
            </svg>
          </div>
          <h1 style={{
            margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.85px',
            lineHeight: 1.08, color: TINTA,
          }}>
            Documento <span style={{ color: VERDE }}>assinado</span>.
          </h1>
          <p style={{ margin: '9px 0 0', fontSize: 13, color: TINTA_2, lineHeight: 1.5, maxWidth: 300 }}>
            Guarde este comprovante: uma foto desta tela já prova a assinatura.
          </p>
        </div>

        {/* ── O recibo ── */}
        <div style={{
          position: 'relative', width: '100%', maxWidth: 320, background: '#fff',
          padding: '17px 16px 15px', border: '1px solid #eef1f4',
          boxShadow: '0 18px 38px -26px rgba(15,23,42,.55)', ...sobe(2, 0.5),
        }}>
          <Picote lado="topo" />
          <Picote lado="base" />

          <p style={{
            margin: 0, fontSize: 8, fontWeight: 700, letterSpacing: '.2em',
            textTransform: 'uppercase', color: TINTA_4,
          }}>
            Protocolo do envelope
          </p>
          <p style={{
            margin: '6px 0 3px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 19, fontWeight: 500, letterSpacing: '.09em', color: TINTA,
            wordBreak: 'break-all', lineHeight: 1.25,
          }}>
            {protocolo || '—'}
          </p>
          <p style={{
            margin: 0, fontSize: 8, fontWeight: 700, letterSpacing: '.2em',
            textTransform: 'uppercase', color: VERDE,
          }}>
            Válido · Autêntico
          </p>
          {protocolo && (
            <button
              type="button"
              onClick={aoCopiarProtocolo}
              style={{
                marginTop: 7, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 10.5, fontWeight: 700, color: LARANJA,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2"
                   strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
              Copiar protocolo
            </button>
          )}

          {/*
            A prova, em miniatura. Some inteira quando não há nem selfie nem
            traço em mãos — o que acontece se a pessoa recarregar a página
            depois de assinar, porque aí ela cai na tela de "já assinado".
          */}
          {(selfie || assinatura) && (
            <>
              <Divisor />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {selfie && (
                  <img
                    src={selfie}
                    alt=""
                    style={{ width: 32, height: 42, borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }}
                  />
                )}
                {assinatura && (
                  <img
                    src={assinatura}
                    alt="Sua assinatura"
                    style={{ flex: 1, minWidth: 0, height: 36, objectFit: 'contain', objectPosition: 'center' }}
                  />
                )}
              </div>
            </>
          )}

          <Divisor />
          <div style={{ textAlign: 'left' }}>
            {documento && <Linha chave="Documento">{documento}</Linha>}
            <Linha chave="Assinado por">{nome}</Linha>
            {assinadoEm && <Linha chave="Assinado em">{assinadoEm}</Linha>}
            {coordenadas && <Linha chave="Local">{coordenadas}</Linha>}
            <Linha chave="Identidade">{identidade}</Linha>
          </div>
        </div>

        {/* ── Ações ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320, ...sobe(4) }}>
          {temArquivoAssinado && (
            <AcaoPrimaria
              onClick={aoAbrir}
              disabled={abrindo}
              icone={
                abrindo ? (
                  <svg width="17" height="17" viewBox="0 0 32 32" style={{ animation: 'ap-gira 1s linear infinite' }} aria-hidden>
                    <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="3" />
                    <circle cx="16" cy="16" r="13" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray="26 56" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 20h16" />
                  </svg>
                )
              }
            >
              {abrindo ? 'Abrindo documento…' : 'Abrir documento assinado'}
            </AcaoPrimaria>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <AcaoSecundaria
              onClick={compartilhando ? undefined : aoCompartilhar}
              icone={
                compartilhando ? <Roda tamanho={14} cor={TINTA_2} /> : (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                  </svg>
                )
              }
            >
              {compartilhando ? 'Preparando…' : 'Compartilhar'}
            </AcaoSecundaria>
            {urlDeVerificacao && (
              <AcaoSecundaria
                onClick={() => window.open(urlDeVerificacao, '_blank', 'noopener,noreferrer')}
                icone={
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
                  </svg>
                }
              >
                Verificar
              </AcaoSecundaria>
            )}
          </div>
        </div>

        {/*
          Modelo `per_document`: um PDF assinado por arquivo do kit, cada um com
          o seu próprio código. Continua inteiro — é o que permite conferir um
          anexo separadamente do documento principal.
        */}
        {documentosAssinados.length > 0 && (
          <div style={{
            width: '100%', maxWidth: 320, border: '1px solid #e7e5e4', borderRadius: 12,
            background: '#fff', overflow: 'hidden', textAlign: 'left', ...sobe(5),
          }}>
            <p style={{
              margin: 0, padding: '10px 12px 6px', fontSize: 8.5, fontWeight: 700,
              letterSpacing: '.14em', textTransform: 'uppercase', color: TINTA_4,
            }}>
              Documentos assinados ({documentosAssinados.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px 12px' }}>
              {documentosAssinados.map((doc) => (
                <div key={doc.documentKey} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{
                      margin: 0, fontSize: 11.5, fontWeight: 600, color: TINTA,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {doc.displayName.replace(/\.(pdf|docx?|rtf|odt)$/i, '')}
                    </p>
                    <p style={{
                      margin: '1px 0 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 9.5, color: TINTA_3, wordBreak: 'break-all',
                    }}>
                      {doc.verificationCode}
                    </p>
                  </div>
                  {doc.url && aoAbrirDocumento && (
                    <button
                      type="button"
                      onClick={() => aoAbrirDocumento(doc.url!)}
                      style={{
                        flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
                        background: '#fff', color: TINTA_2, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"
                           strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
                      </svg>
                      Abrir
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p style={{ margin: 0, maxWidth: 300, fontSize: 10.5, lineHeight: 1.55, color: TINTA_4, ...sobe(6) }}>
          Uma cópia assinada fica disponível para download. O protocolo acima confere a
          autenticidade a qualquer momento
          {documentosAssinados.length > 0 ? ', junto com os códigos de cada documento.' : '.'}
        </p>

        {urlDosTermos && (
          <a
            href={urlDosTermos}
            style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
              color: TINTA_4, textDecoration: 'none', ...sobe(7),
            }}
          >
            Termos de Uso
          </a>
        )}
      </div>
    </MolduraPublica>
  );
};

export default TelaDeComprovante;
