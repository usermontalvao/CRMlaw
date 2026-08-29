/**
 * A conferência — o que a pessoa vê depois de tocar em assinar, enquanto sobem
 * a selfie, o traço e a localização, o servidor confere a identidade e a
 * assinatura entra no documento.
 *
 * É a tela mais perigosa do fluxo: fechar a aba aqui deixa a assinatura pela
 * metade. E era justamente aqui que o aviso NÃO aparecia — o texto "não feche
 * esta janela" só era renderizado quando o documento não tinha nome, ou seja,
 * quase nunca. Quem precisava do recado não recebia.
 *
 * Duas mudanças, e as duas vêm daí:
 *
 *   1. A tarja âmbar é incondicional. Não disputa espaço com etiqueta nenhuma.
 *   2. A tela mostra a PRÓPRIA PROVA sendo conferida — a selfie, o traço do
 *      dedo dela, onde estava, em que aparelho — com uma varredura passando por
 *      cima. Esperar deixa de ser abstrato: dá para ver o que está em análise.
 *
 * Nada no cartão é inventado. Cada campo sai de um estado que a página já tem
 * em mãos no instante em que esta tela sobe (ver `PublicSigningPage`).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  type CanalDeIdentidade,
  descreverAparelho,
  faseDaConferencia,
  progresso as curvaDeProgresso,
} from '../../utils/assinaturaPublica';
import {
  CartaoDeProva,
  MolduraPublica,
  Roda,
  Rotulo,
  RodapeDeConfianca,
  TINTA,
  TINTA_3,
  Tarja,
  sobe,
} from './ui';

/** Carimbo do instante, no relógio de quem assina — é o dele que vale na prova. */
const carimbo = (momento: Date): string =>
  `${momento.toLocaleDateString('pt-BR')} · ${momento.toLocaleTimeString('pt-BR', { hour12: false })}`;

const TelaDeConferencia: React.FC<{
  nome: string;
  cpf?: string | null;
  canal?: CanalDeIdentidade;
  selfie?: string | null;
  assinatura?: string | null;
  local?: { lat: number; lng: number } | null;
}> = ({ nome, cpf, canal = null, selfie, assinatura, local }) => {
  const [decorrido, setDecorrido] = useState(0);
  const montadoEm = useRef(Date.now());
  /** Congelado na montagem: é o instante da assinatura, não o do último tique. */
  const instante = useRef(carimbo(new Date()));
  const aparelho = useRef(descreverAparelho(typeof navigator !== 'undefined' ? navigator.userAgent : ''));

  useEffect(() => {
    const id = window.setInterval(() => {
      setDecorrido((Date.now() - montadoEm.current) / 1000);
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  const pct = curvaDeProgresso(decorrido, 3.2);

  return (
    <MolduraPublica
      tom="trabalhando"
      progresso={pct}
      rodape={<RodapeDeConfianca itens={['Conexão segura', 'AES-256']} />}
    >
      <div
        role="status"
        aria-live="polite"
        aria-label="Conferindo e registrando sua assinatura"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}
      >
        <Rotulo style={sobe(0)}>Conferência em andamento</Rotulo>

        <CartaoDeProva
          nome={nome}
          cpf={cpf}
          canal={canal}
          selfie={selfie}
          assinatura={assinatura}
          local={local}
          aparelho={aparelho.current}
          instante={instante.current}
          conferindo
          style={sobe(1, 0.5)}
        />

        <p style={{
          margin: 0, fontSize: 15.5, fontWeight: 700, color: TINTA, letterSpacing: '-.2px',
          minHeight: 42, maxWidth: 240, lineHeight: 1.3, ...sobe(3),
        }}>
          {faseDaConferencia(decorrido)}
        </p>

        {/*
          Incondicional. Este é o recado que a tela existe para dar, e ele não
          pode depender de o documento ter nome nem de nada mais.
        */}
        <Tarja tom="atencao" style={sobe(4)}>
          Não saia desta página até a conclusão.
        </Tarja>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...sobe(5) }}>
          <Roda />
          <span style={{ fontSize: 11, fontWeight: 500, color: TINTA_3, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>
    </MolduraPublica>
  );
};

export default TelaDeConferencia;
