/**
 * Editor das instruções do agente de IA.
 *
 * É um textarea comum — a configuração continua sendo TEXTO CORRIDO. O que ele
 * ganha é um menu de autocomplete: ao digitar `ação=` aparecem as ações do
 * catálogo e, para as que exigem destino, uma segunda busca com registros REAIS
 * do banco (pessoas, setores e templates que já possuem link ativo).
 *
 * O que o usuário lê continua legível — `ação=transferir(Pedro Rodrigues)` —
 * mas a escolha grava também a referência estruturada com o id real. É ela, e
 * nunca o nome digitado, que o backend usa para executar.
 *
 * Nada aqui executa ação nenhuma: editar prompt é só escrever texto.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import {
  WA_AI_ACTIONS,
  WA_AI_PROMPT_TRIGGER_RE,
  resolveWaAiActionByAlias,
  type WaAiActionDef,
} from '../../utils/waAiActionCatalog';
import type { WhatsAppAiActionRef, WhatsAppAiTargetOption } from '../../types/whatsapp.types';
import { matchesNormalizedSearch, normalizeSearchText } from '../../utils/search';

/** Caret DENTRO dos parênteses de uma expressão em construção. */
const OPEN_TARGET_RE = /a[çc][ãa]o\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()\n]*)$/;

type MenuState =
  | { kind: 'none' }
  | { kind: 'action'; query: string; from: number }
  | { kind: 'target'; action: WaAiActionDef; query: string; from: number };

interface CaretBox { top: number; left: number }

/**
 * Posição do cursor dentro do textarea, para ancorar o menu perto dele.
 *
 * A técnica é um clone invisível do textarea com o texto até o cursor: o
 * navegador quebra as linhas exatamente igual, e a posição do marcador no clone
 * é a posição do cursor no original. Não há API nativa para isso.
 */
function caretPosition(el: HTMLTextAreaElement): CaretBox {
  const style = window.getComputedStyle(el);
  const mirror = document.createElement('div');
  const copy = [
    'boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
    'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'textTransform', 'wordSpacing',
  ] as const;
  for (const prop of copy) mirror.style[prop as any] = style[prop as any];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';

  mirror.textContent = el.value.slice(0, el.selectionStart ?? 0);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const top = marker.offsetTop - el.scrollTop + parseFloat(style.lineHeight || '18');
  const left = marker.offsetLeft;
  document.body.removeChild(mirror);

  return { top, left };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Todas as referências do agente (das duas áreas de instrução). */
  refs: WhatsAppAiActionRef[];
  onAddRef: (ref: WhatsAppAiActionRef) => void;
  /** Marca a ação escolhida como permitida — regra do editor. */
  onUseAction: (action: string) => void;
  targets: WhatsAppAiTargetOption[];
  placeholder?: string;
  rows?: number;
  /** Trechos inválidos apontados pela validação, para destacar abaixo. */
  issues?: { level: 'erro' | 'aviso'; message: string; raw: string }[];
  id?: string;
}

export const AiPromptEditor: React.FC<Props> = ({
  value, onChange, refs, onAddRef, onUseAction, targets, placeholder, rows = 10, issues = [], id,
}) => {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<MenuState>({ kind: 'none' });
  const [highlight, setHighlight] = useState(0);
  const [caret, setCaret] = useState<CaretBox>({ top: 0, left: 0 });

  // `syncMenu` roda a cada tecla e não enxerga o `menu` do render (useCallback
  // sem dependências, de propósito: recriá-lo a cada tecla remontaria os
  // handlers). O ref é como ele compara com o estado atual.
  const menuRef = useRef<MenuState>(menu);
  menuRef.current = menu;

  const closeMenu = useCallback(() => setMenu({ kind: 'none' }), []);

  /**
   * Lê o texto antes do cursor e decide qual menu (se algum) deve aparecer.
   *
   * O item destacado só volta ao primeiro quando o menu MUDA (abriu, trocou de
   * tipo ou a busca mudou). Zerar a cada sincronização apagava a navegação por
   * seta: a tecla movia o destaque e o `keyup` seguinte o trazia de volta ao
   * topo, então o Enter sempre escolhia o primeiro da lista.
   */
  const syncMenu = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    const caretIndex = el.selectionStart ?? 0;
    const before = el.value.slice(0, caretIndex);

    const apply = (next: MenuState) => {
      const prev = menuRef.current;
      const mudou = prev.kind !== next.kind
        || (prev.kind !== 'none' && next.kind !== 'none' && prev.query !== next.query)
        || (prev.kind === 'target' && next.kind === 'target' && prev.action.name !== next.action.name);
      if (mudou) setHighlight(0);
      if (next.kind !== 'none') setCaret(caretPosition(el));
      setMenu(next);
    };

    const openTarget = before.match(OPEN_TARGET_RE);
    if (openTarget) {
      const def = resolveWaAiActionByAlias(openTarget[1]);
      if (def && def.targetSource !== 'none') {
        apply({ kind: 'target', action: def, query: openTarget[2], from: caretIndex - openTarget[2].length });
        return;
      }
    }

    const trigger = before.match(WA_AI_PROMPT_TRIGGER_RE);
    if (trigger) {
      apply({ kind: 'action', query: trigger[1] || '', from: (trigger.index ?? 0) });
      return;
    }

    apply({ kind: 'none' });
  }, []);

  const actionOptions = useMemo(() => {
    if (menu.kind !== 'action') return [];
    const q = normalizeSearchText(menu.query);
    return WA_AI_ACTIONS.filter(a =>
      !q || matchesNormalizedSearch(q, [a.alias, a.name, a.title]));
  }, [menu]);

  const targetOptions = useMemo(() => {
    if (menu.kind !== 'target') return [];
    const q = normalizeSearchText(menu.query);
    const accepts = menu.action.targetSource === 'document_template'
      ? (t: WhatsAppAiTargetOption) => t.type === 'document_template'
      : (t: WhatsAppAiTargetOption) => t.type === 'user' || t.type === 'department';
    return targets
      .filter(t => accepts(t) && (!q || matchesNormalizedSearch(q, [t.label, t.hint])))
      .slice(0, 30);
  }, [menu, targets]);

  const optionCount = menu.kind === 'action' ? actionOptions.length
    : menu.kind === 'target' ? targetOptions.length : 0;

  useEffect(() => {
    if (highlight >= optionCount) setHighlight(0);
  }, [optionCount, highlight]);

  /** Troca um pedaço do texto e recoloca o cursor logo depois dele. */
  const replaceRange = (from: number, to: number, insert: string, caretOffset = insert.length) => {
    const next = `${value.slice(0, from)}${insert}${value.slice(to)}`;
    onChange(next);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      const pos = from + caretOffset;
      el.focus();
      el.setSelectionRange(pos, pos);
      syncMenu();
    });
  };

  const pickAction = (def: WaAiActionDef) => {
    if (menu.kind !== 'action') return;
    const el = areaRef.current;
    const caretIndex = el?.selectionStart ?? value.length;
    onUseAction(def.name);
    if (def.targetSource === 'none') {
      replaceRange(menu.from, caretIndex, `ação=${def.alias}()`);
      closeMenu();
    } else {
      // Deixa o parêntese aberto: o menu de destinos abre sozinho na sequência.
      replaceRange(menu.from, caretIndex, `ação=${def.alias}(`);
    }
  };

  const pickTarget = (option: WhatsAppAiTargetOption) => {
    if (menu.kind !== 'target') return;
    const el = areaRef.current;
    const caretIndex = el?.selectionStart ?? value.length;
    const def = menu.action;

    onUseAction(def.name);
    onAddRef({
      action: def.name,
      target_type: option.type,
      target_id: option.id,
      target_label: option.label,
      raw: `ação=${def.alias}(${option.label})`,
    });
    replaceRange(menu.from, caretIndex, `${option.label})`);
    closeMenu();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu.kind === 'none' || optionCount === 0) {
      if (e.key === 'Escape' && menu.kind !== 'none') { e.preventDefault(); closeMenu(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % optionCount); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + optionCount) % optionCount); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (menu.kind === 'action') pickAction(actionOptions[highlight]);
      else pickTarget(targetOptions[highlight]);
    }
  };

  const menuOpen = menu.kind !== 'none';

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        id={id}
        ref={areaRef}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); requestAnimationFrame(syncMenu); }}
        onClick={syncMenu}
        onKeyUp={e => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) syncMenu(); }}
        onKeyDown={onKeyDown}
        // O menu vive dentro do mesmo container; fechar no blur imediato mataria
        // o clique do mouse antes de ele chegar ao item.
        onBlur={() => window.setTimeout(closeMenu, 150)}
        style={{
          width: '100%', fontSize: '12.5px', lineHeight: '1.6', padding: '10px 12px',
          borderRadius: '9px', border: '1px solid #d1d5db', background: '#fff', color: '#111827',
          fontFamily: 'inherit', resize: 'vertical',
        }}
      />

      {menuOpen && optionCount > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: Math.max(0, caret.top),
            left: Math.min(caret.left, 240),
            zIndex: 40,
            width: '340px',
            maxHeight: '236px',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '10px',
            boxShadow: '0 12px 30px rgba(15,23,42,.16)',
          }}
          onMouseDown={e => e.preventDefault()}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px',
            borderBottom: '1px solid #f3f4f6', fontSize: '10.5px', fontWeight: 700,
            color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            <Search size={11} />
            {menu.kind === 'action' ? 'Ações do sistema' : `Destino de ${menu.action.title}`}
          </div>

          {menu.kind === 'action' && actionOptions.map((def, i) => (
            <button
              key={def.name}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pickAction(def)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                border: 'none', cursor: 'pointer',
                background: i === highlight ? '#fff7ed' : 'transparent',
              }}
            >
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#111827' }}>{def.title}</span>
              <span style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                {def.description}
              </span>
            </button>
          ))}

          {menu.kind === 'target' && targetOptions.map((option, i) => (
            <button
              key={`${option.type}:${option.id}`}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pickTarget(option)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', cursor: 'pointer',
                background: i === highlight ? '#fff7ed' : 'transparent',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#111827' }}>{option.label}</span>
                {/* A dica é o que desempata dois "Pedro" na lista. */}
                {option.hint && (
                  <span style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                    {option.hint}
                  </span>
                )}
              </span>
              <span style={{
                flexShrink: 0, fontSize: '10px', fontWeight: 700, color: '#92400e',
                background: '#fef3c7', borderRadius: '999px', padding: '2px 7px',
              }}>
                {option.type === 'user' ? 'Pessoa' : option.type === 'department' ? 'Setor' : 'Documento'}
              </span>
            </button>
          ))}

          <div style={{
            padding: '6px 10px', borderTop: '1px solid #f3f4f6',
            fontSize: '10.5px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '5px',
          }}>
            <CornerDownLeft size={10} /> Enter seleciona · ↑↓ navega · Esc fecha
          </div>
        </div>
      )}

      {menuOpen && optionCount === 0 && (
        <div style={{
          position: 'absolute', top: Math.max(0, caret.top), left: Math.min(caret.left, 240), zIndex: 40,
          width: '340px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px',
          padding: '10px', fontSize: '11.5px', color: '#6b7280',
          boxShadow: '0 12px 30px rgba(15,23,42,.16)',
        }}>
          {menu.kind === 'target'
            ? menu.action.targetSource === 'document_template'
              ? 'Nenhum template com link ativo corresponde à busca.'
              : 'Nenhuma pessoa ou setor ativo corresponde à busca.'
            : 'Nenhuma ação corresponde ao que foi digitado.'}
        </div>
      )}

      {issues.length > 0 && (
        <ul style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {issues.map((issue, i) => (
            <li key={i} style={{
              fontSize: '11.5px', lineHeight: 1.5,
              color: issue.level === 'erro' ? '#b91c1c' : '#92400e',
            }}>
              <code style={{
                background: issue.level === 'erro' ? '#fef2f2' : '#fffbeb',
                borderRadius: '4px', padding: '1px 5px', marginRight: '6px',
              }}>{issue.raw}</code>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {/* O resumo é o que permite conferir a configuração sem reler o texto. */}
      {refs.length > 0 && (
        <div style={{ marginTop: '10px', fontSize: '11.5px', color: '#6b7280' }}>
          <span style={{ fontWeight: 700, color: '#374151' }}>Ações usadas neste prompt:</span>
          <ul style={{ marginTop: '4px', paddingLeft: '14px', listStyle: 'disc' }}>
            {refs.map((ref, i) => {
              const def = WA_AI_ACTIONS.find(a => a.name === ref.action);
              return <li key={i}>{def?.title || ref.action} → {ref.target_label}</li>;
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AiPromptEditor;
