/**
 * Tokens visuais do módulo Nextcloud.
 * -----------------------------------------------------------------------------
 * O explorador misturava `gray`, `slate` e `zinc` na mesma tela — três escalas de
 * cinza com temperaturas diferentes, que no claro deixavam a área de arquivos
 * encardida e no escuro brigavam entre si. A regra deste módulo, daqui em diante:
 *
 *   - claro  → escala `slate` (e o fundo externo `NC_SHELL_BG`);
 *   - escuro → escala `zinc`;
 *   - `gray` NÃO é usado aqui.
 *
 * O fundo cinza aparece só FORA da área de conteúdo. A superfície onde os
 * arquivos vivem — e as prévias dentro dela — é branca no claro, para que a
 * miniatura de um documento se pareça com papel e não com um bloco cinza.
 *
 * São strings de classe Tailwind de propósito: o projeto não tem (e não deve
 * ganhar) uma camada de tema em runtime só por causa desta tela.
 */

/** Fundo externo, atrás da superfície de conteúdo. Nunca dentro dela. */
export const NC_SHELL_BG = 'bg-[#f1f3f7] dark:bg-zinc-950';

/** Superfície de conteúdo: branca no claro — é a regra visual do módulo. */
export const NC_SURFACE = 'bg-white dark:bg-zinc-900';

/** Superfície secundária (barra lateral, rodapés) — um degrau do fundo externo. */
export const NC_SURFACE_MUTED = 'bg-[#f8f9fb] dark:bg-zinc-950';

/** Borda de contorno das superfícies. */
export const NC_BORDER = 'border-slate-200 dark:border-zinc-800';

/** Divisória interna, mais discreta que `NC_BORDER`. */
export const NC_HAIRLINE = 'border-slate-100 dark:border-zinc-800/70';

export const NC_TEXT = 'text-slate-800 dark:text-slate-100';
export const NC_TEXT_STRONG = 'text-slate-900 dark:text-white';
export const NC_TEXT_MUTED = 'text-slate-500 dark:text-slate-400';
export const NC_TEXT_FAINT = 'text-slate-400 dark:text-slate-500';

/** Hover neutro de linhas, itens de menu e botões fantasma. */
export const NC_HOVER = 'hover:bg-slate-100 dark:hover:bg-zinc-800';

/** Estado selecionado — azul suave, legível sobre superfície branca. */
export const NC_SELECTED = 'bg-[#e8f0fe] dark:bg-blue-950/40';

/** Sombra de elevação discreta (cartões, menus, botão "Novo"). */
export const NC_SHADOW = 'shadow-[0_1px_2px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.08)]';
export const NC_SHADOW_LIFTED = 'shadow-[0_8px_28px_rgba(15,23,42,0.14)]';

/** Anel de foco padrão do módulo (teclado). */
export const NC_FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60';

/** Azul institucional do Nextcloud — usado no logotipo e em ênfases. */
export const NC_BRAND_BLUE = '#0082c9';
