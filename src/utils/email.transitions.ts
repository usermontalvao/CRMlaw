/**
 * Funções puras para transição de estado entre pastas de email.
 *
 * Regra central: uma mensagem pertence a exatamente uma pasta; as flags
 * `is_spam`, `is_trash` e `is_draft` determinam isso. Cada transição deve
 * limpar as flags incompatíveis com o destino.
 *
 * Tabela de estados válidos:
 *   inbox:  is_spam=false, is_trash=false, is_draft=false, direction=inbound
 *   spam:   is_spam=true,  is_trash=false, is_draft=false
 *   trash:  is_trash=true  (is_spam mantido como metadado para restore)
 *   drafts: is_draft=true, is_trash=false
 *   sent:   direction=outbound, is_trash=false, is_draft=false
 *   starred: cross-folder (is_starred=true), não muda pasta
 *
 * Cenários cobertos pelos testes:
 *   Inbox → Trash → Inbox (restore)
 *   Inbox → Spam → Inbox
 *   Spam → Trash → Inbox (restore vai para Spam; depois move p/ inbox)
 *   Trash → Restore
 */

export interface FolderPatch {
  is_spam?: boolean;
  is_trash?: boolean;
  spam_checked?: boolean;
}

/** Patch para mover qualquer mensagem para a Caixa de Entrada. */
export function patchForInbox(): FolderPatch {
  return { is_spam: false, is_trash: false };
}

/**
 * Patch para mover qualquer mensagem para Spam.
 * Limpa is_trash para que saia da lixeira se estava lá.
 */
export function patchForSpam(): FolderPatch {
  return { is_spam: true, is_trash: false, spam_checked: true };
}

/**
 * Patch para mover para a Lixeira.
 * Mantém is_spam intacto para que o restore saiba de onde veio:
 *   - is_spam=true  → restore devolve para Spam
 *   - is_spam=false → restore devolve para Inbox
 */
export function patchForTrash(): FolderPatch {
  return { is_trash: true };
}

/**
 * Patch para restaurar da Lixeira (volta para onde estava antes).
 * is_spam permanece, o filtro de pasta resolve o destino visual.
 */
export function patchForRestore(): FolderPatch {
  return { is_trash: false };
}

/**
 * Infere a pasta visual de uma mensagem a partir dos seus flags.
 * Usado p/ determinar a pasta ao abrir via notificação.
 */
export function resolveFolder(m: {
  is_draft: boolean;
  is_spam: boolean;
  is_trash: boolean;
  direction: 'inbound' | 'outbound';
}): 'inbox' | 'spam' | 'trash' | 'drafts' | 'sent' {
  if (m.is_trash) return 'trash';
  if (m.is_spam) return 'spam';
  if (m.is_draft) return 'drafts';
  if (m.direction === 'outbound') return 'sent';
  return 'inbox';
}

/**
 * Valida se uma mensagem está em estado consistente.
 * Retorna null se OK, ou uma string descrevendo a inconsistência.
 * Útil para debug e testes.
 */
export function validateMessageState(m: {
  is_draft: boolean;
  is_spam: boolean;
  is_trash: boolean;
  direction: 'inbound' | 'outbound';
}): string | null {
  // Rascunho com spam = estado inválido (rascunhos são locais)
  if (m.is_draft && m.is_spam) return 'is_draft=true + is_spam=true';
  // Enviado marcado como spam pode acontecer (mensagem enviada que o filtro pegou)
  // mas is_draft=true + is_trash=true é incomum
  return null;
}

// ─── Testes inline (execução direta em Node/Deno) ─────────────────────────────
// Para rodar: ts-node src/utils/email.transitions.ts
if (typeof process !== 'undefined' && process.argv[1]?.includes('email.transitions')) {
  type Msg = Parameters<typeof resolveFolder>[0];
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`  ✓ ${msg}`);
  };

  console.log('\n── patchForInbox ──');
  const inbox = patchForInbox();
  assert(inbox.is_spam === false, 'is_spam=false');
  assert(inbox.is_trash === false, 'is_trash=false');

  console.log('\n── patchForSpam ──');
  const spam = patchForSpam();
  assert(spam.is_spam === true, 'is_spam=true');
  assert(spam.is_trash === false, 'is_trash=false');

  console.log('\n── patchForTrash ──');
  const trash = patchForTrash();
  assert(trash.is_trash === true, 'is_trash=true');
  assert(trash.is_spam === undefined, 'is_spam não tocado (metadado)');

  console.log('\n── patchForRestore ──');
  const restore = patchForRestore();
  assert(restore.is_trash === false, 'is_trash=false');
  assert(restore.is_spam === undefined, 'is_spam não tocado (destino baseado no metadado)');

  console.log('\n── resolveFolder ──');
  assert(resolveFolder({ is_draft: false, is_spam: false, is_trash: false, direction: 'inbound' }) === 'inbox', 'inbox');
  assert(resolveFolder({ is_draft: false, is_spam: true,  is_trash: false, direction: 'inbound' }) === 'spam', 'spam');
  assert(resolveFolder({ is_draft: false, is_spam: false, is_trash: true,  direction: 'inbound' }) === 'trash', 'trash');
  assert(resolveFolder({ is_draft: false, is_spam: true,  is_trash: true,  direction: 'inbound' }) === 'trash', 'spam+trash = trash (is_trash tem prioridade)');
  assert(resolveFolder({ is_draft: true,  is_spam: false, is_trash: false, direction: 'outbound' }) === 'drafts', 'drafts');
  assert(resolveFolder({ is_draft: false, is_spam: false, is_trash: false, direction: 'outbound' }) === 'sent', 'sent');

  console.log('\n── Fluxo Inbox → Spam → Trash → Restore → Inbox ──');
  let msg: Msg = { is_draft: false, is_spam: false, is_trash: false, direction: 'inbound' };
  assert(resolveFolder(msg) === 'inbox', 'começa em inbox');

  // → Spam
  msg = { ...msg, ...patchForSpam() };
  assert(msg.is_spam === true && msg.is_trash === false, 'após patchForSpam: spam=true, trash=false');
  assert(resolveFolder(msg) === 'spam', 'resolve: spam');

  // → Trash (mantém is_spam como metadado)
  msg = { ...msg, ...patchForTrash() };
  assert(msg.is_spam === true && msg.is_trash === true, 'após patchForTrash: spam=true, trash=true');
  assert(resolveFolder(msg) === 'trash', 'resolve: trash');

  // Restore (volta para spam, is_spam ainda true)
  msg = { ...msg, ...patchForRestore() };
  assert(msg.is_spam === true && msg.is_trash === false, 'após restore: spam=true, trash=false');
  assert(resolveFolder(msg) === 'spam', 'resolve: spam (restaurou para spam, onde estava)');

  // → Inbox (limpeza explícita)
  msg = { ...msg, ...patchForInbox() };
  assert(msg.is_spam === false && msg.is_trash === false, 'após patchForInbox: spam=false, trash=false');
  assert(resolveFolder(msg) === 'inbox', 'resolve: inbox');

  console.log('\nTodos os testes passaram.\n');
}
