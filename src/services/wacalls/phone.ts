// Telefone no formato que o WaCalls espera.
//
// O servidor monta o JID com `types.NewJID(normalizePhone(phone), "s.whatsapp.net")`
// e o `normalizePhone` dele apenas joga fora tudo que não é dígito (inclusive o
// "+"). Ou seja: o campo `phone` do POST /calls é o número em dígitos com código
// do país — `5565999999999` — exatamente como o cliente oficial envia.
//
// Aqui só TRANSFORMAMOS o valor que vai para a linha. O número guardado no CRM
// não é tocado: a conversa continua com o que o WhatsApp mandou.
//
// A regra de Brasil é a mesma de `services/whatsapp/shared.ts#normalizePhone`
// (10 ou 11 dígitos ganham o 55 na frente), repetida aqui porque este módulo
// precisa ficar sem imports para os testes conseguirem carregá-lo.

/**
 * Converte o telefone da conversa no valor do campo `phone` do WaCalls.
 * Devolve '' quando não sobra número plausível — quem chama trata como erro em
 * vez de discar para um JID quebrado.
 */
export function toWaCallsPhone(input: string | null | undefined): string {
  let d = (input || '').replace(/\D/g, '');
  if (!d) return '';
  // Número do WhatsApp costuma chegar como JID ("5565...@s.whatsapp.net"); o
  // replace acima já deixou só os dígitos, mas um sufixo de dispositivo
  // (":12@") viraria lixo colado no fim. Corta no tamanho máximo plausível.
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return '';
  return d;
}

/** O JID que o WaCalls devolve nos eventos ("5565...@s.whatsapp.net") → dígitos. */
export function phoneFromWaCallsPeer(peer: string | null | undefined): string {
  const raw = (peer || '').split('@')[0].split(':')[0];
  return raw.replace(/\D/g, '');
}
