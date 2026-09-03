/**
 * A abertura da assinatura pública — o que a pessoa vê entre bater no link do
 * WhatsApp e o documento aparecer.
 *
 * A versão anterior era uma sala de máquinas: escudo com dois anéis pulsando,
 * cinco documentos voando na horizontal, três passos com visto, barra de
 * progresso, roda, porcentagem e três selos jurídicos — treze coisas se mexendo
 * ao mesmo tempo, e nenhuma delas era a pessoa. O assunto da tela era o
 * sistema.
 *
 * Aqui a máquina sai de cena. Sobram o nome de quem vai assinar, o que vai ser
 * assinado e uma frase que muda. O progresso vira um fio de 2,5 px no alto, que
 * a pessoa vê pelo canto do olho e não precisa ler.
 *
 * DEFINIDA NO NÍVEL DO MÓDULO de propósito, como a antecessora: declarada
 * dentro do componente pai, ela seria um tipo novo a cada render e o React
 * desmontaria e remontaria a tela inteira a cada tique do relógio.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  faseDaAbertura,
  primeiroNome,
  progresso as curvaDeProgresso,
  saudacao,
} from '../../utils/assinaturaPublica';
import {
  EtiquetaDoDocumento,
  Explicacao,
  MolduraPublica,
  NomeGrande,
  Roda,
  RodapeDeConfianca,
  TINTA_2,
  VERDE,
  sobe,
} from './ui';

const TelaDeAbertura: React.FC<{
  docName?: string;
  allDocNames?: string[];
  signerName?: string;
  /**
   * O documento está de fato na tela atrás desta cortina.
   *
   * Sem isto, a última frase que a pessoa lia era "Quase lá…" e a tela sumia —
   * a chegada nunca era anunciada. E não dava para inventar pelo relógio: a
   * cortina tem um piso de 10 s, então qualquer contagem própria diria "pronto"
   * antes ou depois da hora. Este sinal vem de quem sabe: o carregamento.
   */
  pronto?: boolean;
  /**
   * A espera passou de qualquer limite razoável e nada garante que ela vá
   * terminar. Vira uma saída — nunca um diagnóstico: a tela não sabe se o
   * problema é a rede, o arquivo ou o aparelho, e não vai fingir que sabe.
   */
  travado?: boolean;
  /** O que fazer quando `travado`. Sem isto, o socorro não aparece. */
  onRecarregar?: () => void;
}> = ({ docName, allDocNames, signerName, pronto, travado, onRecarregar }) => {
  const [decorrido, setDecorrido] = useState(0);
  const montadoEm = useRef(Date.now());

  /**
   * O nome chega depois da tela (vem da consulta ao servidor). Guardado aqui
   * assim que aparece, ele NUNCA volta a ficar vazio — trocar "Maria." de volta
   * para a saudação seca no meio da espera seria pior do que nunca ter mostrado.
   */
  const [nomeResolvido, setNomeResolvido] = useState(signerName || '');
  useEffect(() => {
    if (signerName && !nomeResolvido) setNomeResolvido(signerName);
  }, [signerName, nomeResolvido]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDecorrido((Date.now() - montadoEm.current) / 1000);
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  const pct = curvaDeProgresso(decorrido, 4);
  const nome = primeiroNome(nomeResolvido);
  const cumprimento = saudacao();
  const documentos = allDocNames && allDocNames.length > 0 ? allDocNames : docName ? [docName] : [];

  return (
    <MolduraPublica
      tom={pronto ? 'pronto' : 'trabalhando'}
      progresso={pronto ? 100 : pct}
      alinhamento="inicio"
      rodape={<RodapeDeConfianca itens={['Conexão segura', 'Jurius']} alinhamento="inicio" />}
    >
      <div role="status" aria-live="polite" aria-label="Carregando documento">
        {nome
          ? <NomeGrande acima={`${cumprimento},`} nome={`${nome}.`} style={sobe(0, 0.5)} />
          : (
            <h1 style={{
              margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: '-1.1px',
              lineHeight: 1.04, color: '#0f172a', ...sobe(0, 0.5),
            }}>
              {cumprimento}.
            </h1>
          )}

        <Explicacao style={{ marginTop: 13, ...sobe(2) }}>
          {documentos.length > 1
            ? 'Seus documentos estão sendo abertos.'
            : 'Seu documento está sendo aberto.'}
        </Explicacao>

        {documentos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', marginTop: 18 }}>
            {documentos.slice(0, 4).map((nomeDoc, i) => (
              <EtiquetaDoDocumento key={`${nomeDoc}-${i}`} nome={nomeDoc} principal={i === 0} style={sobe(3 + i)} />
            ))}
            {documentos.length > 4 && (
              <span style={{ fontSize: 10.5, color: '#94a3b8', paddingLeft: 4, ...sobe(7) }}>
                e mais {documentos.length - 4}
              </span>
            )}
          </div>
        )}

        {/*
          Uma frase por vez, no lugar da lista de passos com visto. Ela NUNCA diz
          "pronto" por conta própria (ver `faseDaAbertura`) — quem tem esse
          direito é o `pronto`, que vem do carregamento de verdade.

          A roda ao lado é o que separa "está trabalhando" de "travou": sem ela,
          uma frase parada por oito segundos parece uma tela morta.
        */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          margin: '30px 0 0', minHeight: 34, ...sobe(8),
        }}>
          {pronto ? (
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 17, height: 17, borderRadius: 999, background: VERDE, flex: '0 0 auto',
            }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#fff"
                   strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12l5 5L20 6" />
              </svg>
            </span>
          ) : (
            <Roda tamanho={17} />
          )}
          <p style={{
            margin: 0, fontSize: 12.5, maxWidth: 240, lineHeight: 1.45,
            color: pronto ? VERDE : TINTA_2,
            fontWeight: pronto ? 600 : 400,
          }}>
            {pronto ? 'Pronto para assinar.' : faseDaAbertura(decorrido)}
          </p>
        </div>

        {/*
          A SAÍDA.

          Antes daqui a cortina era uma sala sem porta: se o documento nunca
          terminasse de montar, ela girava a roda para sempre — e quem estava do
          outro lado só tinha a opção de fechar e desistir de assinar. Aparece
          tarde de propósito: oferecer "recarregar" cedo ensina a recarregar por
          impaciência, e aí sim a espera nunca acaba.
        */}
        {travado && !pronto && onRecarregar && (
          <div style={{ marginTop: 22, ...sobe(9) }}>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: TINTA_2, maxWidth: 260 }}>
              Está demorando mais do que deveria. Abrir de novo costuma resolver —
              e você não perde nada.
            </p>
            <button
              onClick={onRecarregar}
              style={{
                marginTop: 11, minHeight: 42, padding: '0 18px', borderRadius: 999,
                border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, color: '#ea580c',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              Abrir de novo
            </button>
          </div>
        )}
      </div>
    </MolduraPublica>
  );
};

export default TelaDeAbertura;
