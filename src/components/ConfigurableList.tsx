/**
 * ConfigurableList — componente genérico para listas configuráveis.
 * CRUD real + drag-and-drop (@dnd-kit) + cor + ativar/desativar + padrão + bloqueio por vínculo.
 * Segue a diretriz: DIRETRIZ_LISTAS_CONFIGURAVEIS.md
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Star,
  StarOff,
  Check,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';

// ── Tipo canônico ─────────────────────────────────────────────────────────────

export interface ConfigurableItem {
  id: string;
  label: string;
  description?: string;
  color?: string;        // hex (#rrggbb)
  icon?: string;
  order: number;
  active: boolean;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
}

// ── Helper: normalizar lista legada → ConfigurableItem[] ─────────────────────
// Compatível com shapes existentes que usam 'key' em vez de 'id'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeItems(raw: any[]): ConfigurableItem[] {
  return raw.map((item, idx) => ({
    id:          String(item.id ?? item.key ?? `item_${idx}`),
    label:       String(item.label ?? ''),
    description: item.description != null ? String(item.description) : undefined,
    color:       item.color != null ? String(item.color) : (item.badge != null ? undefined : undefined),
    icon:        item.icon != null ? String(item.icon) : undefined,
    order:       typeof item.order === 'number' ? item.order : idx,
    active:      item.active !== false,
    isDefault:   Boolean(item.isDefault),
    metadata:    {
      ...(item.badge != null ? { badge: item.badge } : {}),
      ...(item.duration_min != null ? { duration_min: item.duration_min } : {}),
      ...(item.gradient != null ? { gradient: item.gradient } : {}),
      ...(item.accent != null ? { accent: item.accent } : {}),
    },
  }));
}

// ── Paleta de cores da marca (laranja/âmbar + neutros) ───────────────────────

const PRESET_COLORS = [
  '#f97316', // orange-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#22c55e', // green-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#64748b', // slate-500
  '#1e293b', // slate-800
];

// ── Linha sortable ─────────────────────────────────────────────────────────────

interface SortableRowProps {
  item: ConfigurableItem;
  showColor: boolean;
  showDefault: boolean;
  showDescription: boolean;
  onEdit: (item: ConfigurableItem) => void;
  onToggleActive: (item: ConfigurableItem) => void;
  onToggleDefault: (item: ConfigurableItem) => void;
  onDelete: (item: ConfigurableItem) => void;
  deleteLoading: string | null;
  noDelete?: boolean;
  noDeleteIds?: Set<string>;
}

const SortableRow: React.FC<SortableRowProps> = ({
  item, showColor, showDefault, showDescription,
  onEdit, onToggleActive, onToggleDefault, onDelete, deleteLoading, noDelete, noDeleteIds,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all',
        item.active
          ? 'bg-[#f8f7f5] border-[#e7e5df] hover:border-orange-200 hover:shadow-sm'
          : 'bg-slate-50 border-slate-100 opacity-60',
        isDragging ? 'shadow-lg ring-2 ring-orange-300' : '',
      ].join(' ')}
    >
      {/* Handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition p-0.5 rounded"
        aria-label="Arrastar para reordenar"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Cor */}
      {showColor && (
        <span
          className="flex-shrink-0 w-3.5 h-3.5 rounded-full border border-white shadow-sm"
          style={{ backgroundColor: item.color || '#94a3b8' }}
        />
      )}

      {/* Label e descrição */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${item.active ? 'text-slate-800' : 'text-slate-500'}`}>
          {item.label}
          {item.isDefault && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
              <Star className="w-2.5 h-2.5" />
              padrão
            </span>
          )}
        </p>
        {showDescription && item.description && (
          <p className="text-xs text-slate-400 truncate mt-0.5">{item.description}</p>
        )}
      </div>

      {/* Ações — sempre visíveis (delete crítico não pode depender de hover) */}
      <div className="flex items-center gap-1">
        {showDefault && (
          <button
            type="button"
            onClick={() => onToggleDefault(item)}
            title={item.isDefault ? 'Remover padrão' : 'Definir como padrão'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 transition"
          >
            {item.isDefault ? <StarOff className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => onToggleActive(item)}
          title={item.active ? 'Desativar' : 'Ativar'}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
        >
          {item.active
            ? <ToggleRight className="w-4 h-4 text-orange-500" />
            : <ToggleLeft className="w-4 h-4" />
          }
        </button>

        <button
          type="button"
          onClick={() => onEdit(item)}
          title="Editar"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>

        {!noDelete && !noDeleteIds?.has(item.id) && (
          <button
            type="button"
            onClick={() => onDelete(item)}
            disabled={deleteLoading === item.id}
            title="Excluir"
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-40"
          >
            {deleteLoading === item.id
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />
            }
          </button>
        )}
      </div>
    </div>
  );
};

// ── Formulário inline (add / edit) ────────────────────────────────────────────

interface ItemFormProps {
  initial?: ConfigurableItem;
  showColor: boolean;
  showDefault: boolean;
  showDescription: boolean;
  extraFields?: (draft: ConfigurableItem, onChange: (patch: Partial<ConfigurableItem>) => void) => React.ReactNode;
  onSave: (item: ConfigurableItem) => void;
  onCancel: () => void;
}

const ItemForm: React.FC<ItemFormProps> = ({
  initial, showColor, showDefault, showDescription, extraFields, onSave, onCancel,
}) => {
  const [draft, setDraft] = useState<ConfigurableItem>(
    initial ?? {
      id: crypto.randomUUID(),
      label: '',
      description: '',
      color: '#f97316',
      order: 0,
      active: true,
      isDefault: false,
      metadata: {},
    },
  );

  const patch = useCallback((p: Partial<ConfigurableItem>) => setDraft(d => ({ ...d, ...p })), []);

  const handleSave = () => {
    if (!draft.label.trim()) return;
    onSave({ ...draft, label: draft.label.trim() });
  };

  return (
    <div className="rounded-xl border-2 border-orange-200 bg-orange-50/30 p-4 space-y-3">
      {/* Label */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Nome *</label>
        <input
          autoFocus
          type="text"
          value={draft.label}
          onChange={e => patch({ label: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onCancel(); }}
          placeholder="Nome do item"
          className="w-full px-3 py-2 text-sm border border-[#e7e5df] rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 bg-[#f8f7f5]"
        />
      </div>

      {/* Descrição */}
      {showDescription && (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Descrição</label>
          <input
            type="text"
            value={draft.description ?? ''}
            onChange={e => patch({ description: e.target.value })}
            placeholder="Descrição opcional"
            className="w-full px-3 py-2 text-sm border border-[#e7e5df] rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-orange-400 bg-[#f8f7f5]"
          />
        </div>
      )}

      {/* Cor */}
      {showColor && (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-2">Cor</label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => patch({ color: c })}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${draft.color === c ? 'border-slate-800 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={draft.color || '#f97316'}
              onChange={e => patch({ color: e.target.value })}
              className="w-7 h-7 rounded-full cursor-pointer border border-[#e7e5df]"
              title="Cor personalizada"
            />
          </div>
        </div>
      )}

      {/* Padrão */}
      {showDefault && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!draft.isDefault}
            onChange={e => patch({ isDefault: e.target.checked })}
            className="w-4 h-4 rounded accent-orange-500"
          />
          <span className="text-xs font-medium text-slate-600">Definir como padrão nos formulários</span>
        </label>
      )}

      {/* Campos extras (por lista) */}
      {extraFields?.(draft, patch)}

      {/* Ações */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={!draft.label.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition disabled:opacity-40"
        >
          <Check className="w-4 h-4" />
          {initial ? 'Salvar' : 'Adicionar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-4 py-2 border border-[#e7e5df] text-slate-600 text-sm font-medium rounded-lg hover:bg-white transition"
        >
          <X className="w-4 h-4" />
          Cancelar
        </button>
      </div>
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

export interface ConfigurableListProps {
  items: ConfigurableItem[];
  onChange: (next: ConfigurableItem[]) => void;

  // Feature flags
  showColor?: boolean;
  showDefault?: boolean;
  showDescription?: boolean;

  // Rótulo do botão adicionar
  addLabel?: string;

  // Validação de vínculo antes de excluir (retorna contagem de referências)
  countRef?: (item: ConfigurableItem) => Promise<number>;

  // Campos extras no formulário (metadata por lista)
  extraFields?: (draft: ConfigurableItem, onChange: (patch: Partial<ConfigurableItem>) => void) => React.ReactNode;

  // Mensagem quando lista está vazia
  emptyMessage?: string;

  disabled?: boolean;
  noDelete?: boolean;
  noDeleteIds?: Set<string>;
}

export const ConfigurableList: React.FC<ConfigurableListProps> = ({
  items,
  onChange,
  showColor = true,
  showDefault = false,
  showDescription = false,
  addLabel = 'Adicionar item',
  countRef,
  extraFields,
  emptyMessage = 'Nenhum item cadastrado.',
  disabled = false,
  noDelete = false,
  noDeleteIds,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sorted = [...items].sort((a, b) => a.order - b.order);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = sorted.findIndex(i => i.id === active.id);
    const to   = sorted.findIndex(i => i.id === over.id);
    const moved = arrayMove(sorted, from, to).map((item, idx) => ({ ...item, order: idx }));
    onChange(moved);
  };

  const handleSaveNew = (item: ConfigurableItem) => {
    const next = [...items, { ...item, order: items.length }];
    onChange(next);
    setAdding(false);
  };

  const handleSaveEdit = (updated: ConfigurableItem) => {
    onChange(items.map(i => i.id === updated.id ? updated : i));
    setEditingId(null);
  };

  const handleToggleActive = (item: ConfigurableItem) => {
    onChange(items.map(i => i.id === item.id ? { ...i, active: !i.active } : i));
  };

  const handleToggleDefault = (item: ConfigurableItem) => {
    // Apenas um padrão por vez
    onChange(items.map(i => ({ ...i, isDefault: i.id === item.id ? !item.isDefault : false })));
  };

  const handleDelete = async (item: ConfigurableItem) => {
    setDeleteError(null);

    if (countRef) {
      setDeleteLoading(item.id);
      try {
        const count = await countRef(item);
        if (count > 0) {
          setDeleteError(`"${item.label}" está em uso em ${count} registro${count > 1 ? 's' : ''}. Desative-o ao invés de excluir.`);
          return;
        }
      } catch {
        // seguro ignorar
      } finally {
        setDeleteLoading(null);
      }
    }

    onChange(
      items
        .filter(i => i.id !== item.id)
        .map((i, idx) => ({ ...i, order: idx })),
    );
  };

  return (
    <div className="space-y-2">
      {/* Erro de vínculo */}
      {deleteError && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-medium text-amber-800">{deleteError}</p>
          </div>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="ml-auto text-amber-400 hover:text-amber-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Lista com DnD */}
      {sorted.length === 0 && !adding ? (
        <p className="text-xs text-slate-400 text-center py-4">{emptyMessage}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sorted.map(i => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {sorted.map(item =>
                editingId === item.id ? (
                  <ItemForm
                    key={item.id}
                    initial={item}
                    showColor={showColor}
                    showDefault={showDefault}
                    showDescription={showDescription}
                    extraFields={extraFields}
                    onSave={handleSaveEdit}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <SortableRow
                    key={item.id}
                    item={item}
                    showColor={showColor}
                    showDefault={showDefault}
                    showDescription={showDescription}
                    onEdit={i => { setEditingId(i.id); setAdding(false); }}
                    onToggleActive={handleToggleActive}
                    onToggleDefault={handleToggleDefault}
                    onDelete={handleDelete}
                    deleteLoading={deleteLoading}
                    noDelete={noDelete}
                    noDeleteIds={noDeleteIds}
                  />
                ),
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Formulário de adição */}
      {adding ? (
        <ItemForm
          showColor={showColor}
          showDefault={showDefault}
          showDescription={showDescription}
          extraFields={extraFields}
          onSave={handleSaveNew}
          onCancel={() => setAdding(false)}
        />
      ) : (
        !disabled && (
          <button
            type="button"
            onClick={() => { setAdding(true); setEditingId(null); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-xl border border-dashed border-orange-200 hover:border-orange-300 transition"
          >
            <Plus className="w-4 h-4" />
            {addLabel}
          </button>
        )
      )}
    </div>
  );
};

export default ConfigurableList;
