import React, { useState } from 'react';

/**
 * O ROSTO DE QUEM ASSINA.
 *
 * Um cartão de assinatura é sobre uma pessoa, e a lista inteira mostrava
 * apenas o mesmo ícone de documento repetido — nada distinguia um cartão do
 * outro à distância. O avatar devolve a identidade, com um anel na cor do
 * estado, que faz o cartão dizer de longe se aquilo já terminou.
 *
 * DE ONDE VEM A IMAGEM, no módulo de assinaturas: a **selfie tirada na hora de
 * assinar** (`signatureService.listSignerSelfies`), porque aqui o rosto serve
 * para reconhecer o ATO, não só a pessoa. Nos demais módulos do CRM o rosto do
 * cliente continua vindo da **foto do WhatsApp** — este componente recebe a URL
 * pronta e não sabe (nem precisa saber) qual das duas é.
 *
 * A foto que falha em carregar cai nas iniciais em silêncio — link quebrado
 * nunca vira quadrado cinza no meio da lista.
 */

const CORES_DE_FUNDO = [
  { bg: '#fef3c7', fg: '#92400e' },
  { bg: '#dbeafe', fg: '#1e40af' },
  { bg: '#dcfce7', fg: '#166534' },
  { bg: '#f3e8ff', fg: '#6b21a8' },
  { bg: '#ffe4e6', fg: '#9f1239' },
  { bg: '#e0f2fe', fg: '#075985' },
];

export function iniciaisDe(nome: string | null | undefined): string {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Mesma pessoa, mesma cor, sempre — a cor vira parte de reconhecê-la. */
function corDe(nome: string | null | undefined) {
  const texto = String(nome || '');
  let soma = 0;
  for (let i = 0; i < texto.length; i += 1) soma = (soma + texto.charCodeAt(i)) % 997;
  return CORES_DE_FUNDO[soma % CORES_DE_FUNDO.length];
}

export interface AvatarDoSignatarioProps {
  nome?: string | null;
  fotoUrl?: string | null;
  /** Diâmetro em pixels. */
  tamanho?: number;
  /** Cor do anel — normalmente a cor do estado do documento. */
  anel?: string | null;
  titulo?: string;
}

export const AvatarDoSignatario: React.FC<AvatarDoSignatarioProps> = ({
  nome,
  fotoUrl,
  tamanho = 36,
  anel = null,
  titulo,
}) => {
  const [falhou, setFalhou] = useState(false);
  const cor = corDe(nome);
  const mostrarFoto = Boolean(fotoUrl) && !falhou;

  return (
    <div
      title={titulo ?? nome ?? undefined}
      style={{
        width: tamanho,
        height: tamanho,
        borderRadius: '50%',
        flexShrink: 0,
        overflow: 'hidden',
        background: mostrarFoto ? '#f1f5f9' : cor.bg,
        border: anel ? `2px solid ${anel}` : '2px solid #ffffff',
        boxShadow: anel ? 'none' : '0 0 0 1px #e7e5df',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {mostrarFoto ? (
        <img
          src={fotoUrl as string}
          alt=""
          onError={() => setFalhou(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <span
          style={{
            fontSize: Math.max(9, Math.round(tamanho * 0.34)),
            fontWeight: 700,
            color: cor.fg,
            letterSpacing: '0.02em',
            userSelect: 'none',
          }}
        >
          {iniciaisDe(nome)}
        </span>
      )}
    </div>
  );
};

export default AvatarDoSignatario;
