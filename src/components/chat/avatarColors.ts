// A COR DE QUEM NÃO TEM FOTO.
//
// Todo avatar sem foto do CRM era o MESMO laranja: no chat da equipe, um
// degradê laranja-âmbar-laranja com sombra preta; na inbox do WhatsApp, um
// creme com letra âmbar. Quatro conversas na tela viravam quatro círculos
// laranja idênticos — a cor da marca gasta em quem ainda não tem cara, e
// nenhuma ajuda para distinguir uma linha da outra.
//
// Aqui a cor sai do NOME: a mesma pessoa tem sempre a mesma cor, em qualquer
// lista, em qualquer sessão, sem nada guardado. São oito tons claros de fundo
// com a letra escura — a família que agenda de contatos e cliente de e-mail
// sérios usam, porque ela distingue sem gritar e continua legível em cima de
// branco.
//
// Sem import nenhum de propósito: é o que deixa testar com `node --test`.

export interface CorDeAvatar { bg: string; fg: string }

/** Oito tons; nenhum deles é o laranja da marca, que fica reservado para ação. */
const PALETA: CorDeAvatar[] = [
  { bg: '#e8f0fe', fg: '#1a56c4' }, // azul
  { bg: '#e6f4ea', fg: '#137333' }, // verde
  { bg: '#fce8e6', fg: '#c5221f' }, // vermelho
  { bg: '#fef7e0', fg: '#8a5a05' }, // âmbar
  { bg: '#f3e8fd', fg: '#7627bb' }, // roxo
  { bg: '#e0f7fa', fg: '#00697a' }, // ciano
  { bg: '#fde8f1', fg: '#b4187a' }, // rosa
  { bg: '#eceff1', fg: '#455a64' }, // ardósia
];

/**
 * Cor estável para um nome (ou telefone, ou qualquer identidade textual).
 *
 * Soma simples dos códigos: barata o suficiente para rodar em toda linha de
 * uma inbox de 800 conversas, e estável entre sessões — o que importa aqui é
 * que a MESMA pessoa nunca troque de cor, não que a distribuição seja perfeita.
 */
export const coresDoNome = (nome: string | null | undefined): CorDeAvatar => {
  const s = (nome || '').trim().toLowerCase();
  if (!s) return PALETA[PALETA.length - 1];
  let soma = 0;
  for (let i = 0; i < s.length; i++) soma = (soma + s.charCodeAt(i) * (i + 1)) % 100000;
  return PALETA[soma % PALETA.length];
};

export const PALETA_DE_AVATAR = PALETA;
