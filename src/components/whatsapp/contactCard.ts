// O cartão de contato que o cliente manda — lido de volta a partir do texto.
//
// De onde vem o texto. O webhook não guarda o vCard cru na thread: ele
// transforma o cartão num texto legível e grava em `content` (ver
// `_shared/wa-native-content.ts#textoDeContatos`), no formato
//
//     Nome da pessoa
//     +5565988887777
//     +556533334444
//
//     Segunda pessoa
//     +5565911112222
//
// — nome na primeira linha, telefones abaixo, cartões separados por linha em
// branco. Foi uma decisão boa: o dado aparece na bolha, na prévia da lista, no
// aviso de mensagem nova, na exportação e no contexto da IA, tudo sem coluna
// nova. E é por isso que a leitura de volta acontece AQUI, e não do `raw` — o
// `raw` nem é trazido para a tela (ver `MSG_COLUMNS`), e as mensagens que já
// estão no banco continuam funcionando.
//
// PARA QUE. Enquanto isto era só texto, o cartão de contato era um beco: o
// escritório via o número do perito, do despachante, do parente do cliente — e
// tinha de selecionar com o mouse, copiar e colar em outro lugar para fazer
// qualquer coisa com ele. Com o cartão lido, o número vira botão: ligar,
// vincular a um cadastro, encaminhar.
//
// PURO DE PROPÓSITO: nenhum import (ver o cabeçalho de `attendanceRouting.ts`).

/** Uma pessoa do cartão recebido. */
export interface ContactCardEntry {
  name: string;
  /** Telefones em DÍGITOS, na ordem em que vieram, sem repetição. */
  phones: string[];
}

/** 55 + DDD + 8/9 dígitos — o que o CRM considera um telefone brasileiro. */
const MSISDN = /^\d{12,13}$/;

/**
 * Normaliza um telefone do cartão para dígitos.
 *
 * Devolve '' para o que não é telefone. O caso que importa é o identificador
 * interno do WhatsApp: um cartão pode trazer `1234567890123456@lid` no lugar do
 * número, e transformar aquilo em "+1234567890123456" é exatamente o defeito
 * que fez o CRM discar para a Somália. LID não é telefone, aqui também não.
 */
export function contactCardPhone(raw: string): string {
  const bruto = (raw || '').trim();
  if (!bruto || /@lid\b/i.test(bruto)) return '';
  let d = bruto.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return MSISDN.test(d) ? d : '';
}

/** A linha é um telefone (e não parte do nome)? */
function ehLinhaDeTelefone(linha: string): boolean {
  // Uma linha de telefone é feita só de dígitos, espaço, +, (), - e ponto. Um
  // nome com número dentro ("Loja 24h") tem letras e não passa por aqui.
  return /^[+\d][\d\s().+-]*$/.test(linha.trim());
}

/**
 * Lê o texto do cartão de contato e devolve as pessoas que estão nele.
 *
 * Tolerante de propósito: um cartão sem telefone nenhum ainda produz uma
 * entrada (com o nome), porque a bolha precisa continuar mostrando o nome — e
 * porque é assim que a tela consegue dizer "este cartão veio sem número" em vez
 * de sumir com a mensagem.
 */
export function parseContactMessage(content: string | null | undefined): ContactCardEntry[] {
  const texto = (content || '').replace(/\r\n/g, '\n').trim();
  if (!texto) return [];

  const entries: ContactCardEntry[] = [];
  for (const bloco of texto.split(/\n\s*\n/)) {
    const linhas = bloco.split('\n').map(l => l.trim()).filter(Boolean);
    if (linhas.length === 0) continue;

    const nomes: string[] = [];
    const phones: string[] = [];
    for (const linha of linhas) {
      if (ehLinhaDeTelefone(linha)) {
        const digitos = contactCardPhone(linha);
        // O mesmo número aparece duas vezes no cartão do WhatsApp (uma cru e
        // outra mascarada); comparar por dígito evita mostrar dois botões iguais.
        if (digitos && !phones.includes(digitos)) phones.push(digitos);
        continue;
      }
      nomes.push(linha);
    }
    entries.push({ name: nomes.join(' ').trim() || 'Contato sem nome', phones });
  }
  return entries;
}
