import React, { useEffect, useState, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  X,
  Check,
  CheckCheck,
  Clock,
  Calendar,
  Briefcase,
  FileText,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Volume2,
  VolumeX,
  Trash2,
  PenTool,
  UserCheck,
  Mail,
} from 'lucide-react';
import { userNotificationService } from '../services/userNotification.service';
import { useAuth } from '../contexts/AuthContext';
import usePermissions from '../hooks/usePermissions';
import { supabase } from '../config/supabase';
import { pushNotifications } from '../utils/pushNotifications';
import type { UserNotification } from '../types/user-notification.types';

interface NotificationBellProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

// AudioContext compartilhado — criado/resumido só após gesto do usuário
let sharedAudioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  try {
    if (!sharedAudioContext) {
      sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Tenta retomar se suspenso (navegador pode suspender após inatividade)
    if (sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume().catch(() => {});
    }
    // Bloqueia se ainda não foi liberado pelo browser (sem gesto do usuário ainda)
    if (sharedAudioContext.state === 'running') return sharedAudioContext;
    return null;
  } catch {
    return null;
  }
};

// Toca um tom único com envelope suave (ataque/descida em rampa) — evita o
// "clique" de começar/terminar o som no volume cheio.
const playTone = (
  ctx: AudioContext,
  freq: number,
  startAt: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine',
) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startAt;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.025); // ataque suave
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // descida suave
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
};

// Som de notificação. 'email' = chime macio de dois tons (mais baixo e gentil);
// 'default' = bipe único, agora com envelope suave (sem clique) e volume menor.
const playNotificationSound = (kind: 'default' | 'email' = 'default') => {
  try {
    const ctx = getAudioContext();
    if (!ctx) return; // sem gesto do usuário ainda — silencioso
    if (kind === 'email') {
      // dois tons ascendentes, suaves, sobrepondo levemente — tipo "tlim-tlim"
      playTone(ctx, 660, 0, 0.26, 0.09); // E5
      playTone(ctx, 880, 0.13, 0.36, 0.08); // A5
    } else {
      playTone(ctx, 760, 0, 0.3, 0.16);
    }
  } catch {}
};

/* ─────────────────────────────────────────────────────────────────────────
   POPUP NOTIFICATION ITEM  (auto-dismiss 10 s + countdown bar)
───────────────────────────────────────────────────────────────────────── */

const POPUP_DURATION = 10000;

interface PopupItemProps {
  notification: UserNotification;
  onDismiss: (id: string) => void;
  onNavigate: (n: UserNotification) => void;
  getIcon: (n: UserNotification) => React.ReactNode;
  getIconBgColor: (n: UserNotification) => string;
  isSignatureNotification: (n: UserNotification) => boolean;
  getSignatureBadge: (n: UserNotification) => string;
  getSignatureProgress: (n: UserNotification) => { signedCount: number; totalSigners: number; pct: number } | null;
}

const PopupItem = memo<PopupItemProps>(({
  notification, onDismiss, onNavigate, getIcon, getIconBgColor,
  isSignatureNotification, getSignatureBadge, getSignatureProgress,
}) => {
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(notification.id), 350);
  }, [notification.id, onDismiss]);

  // Auto-dismiss after 10 s
  useEffect(() => {
    const t = setTimeout(dismiss, POPUP_DURATION);
    return () => clearTimeout(t);
  }, [dismiss]);

  const urgency = notification.metadata?.urgency as string | undefined;
  const isSig = isSignatureNotification(notification);
  const isCompleted = notification.metadata?.signature_type === 'completed';

  // Cor de destaque (topo + barra de contagem) por tipo/urgência
  const accent =
    urgency === 'critica' ? '#ef4444'
    : urgency === 'alta' ? '#f97316'
    : isSig ? (isCompleted ? '#10b981' : '#0d9488')
    : notification.type === 'deadline_assigned' || notification.type === 'deadline_reminder' ? '#f59e0b'
    : '#ea580c';

  return (
    <div
      className={`pointer-events-auto bg-[#f8f7f5] cursor-pointer select-none overflow-hidden transition-all duration-300 ${
        exiting ? 'opacity-0 translate-x-4 scale-[0.97]' : 'opacity-100 translate-x-0 scale-100'
      }`}
      style={{
        width: 'min(calc(100vw - 2rem), 360px)',
        borderRadius: 16,
        boxShadow: '0 12px 40px -8px rgba(15,23,42,0.18), 0 0 0 1px rgba(15,23,42,0.05)',
      }}
      onClick={() => { if (!exiting) { setExiting(true); setTimeout(() => onNavigate(notification), 150); } }}
    >
      {/* Faixa fina no topo */}
      <div style={{ height: 3, background: accent }} />

      <div style={{ display: 'flex', gap: 12, padding: '14px 14px 12px' }}>
        {/* Ícone */}
        <div className={`flex-shrink-0 ${getIconBgColor(notification)}`}
          style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {getIcon(notification)}
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Linha de status (badge sutil) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            {urgency === 'critica' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: '#dc2626', textTransform: 'uppercase' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444' }} />Crítica
              </span>
            )}
            {urgency === 'alta' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: '#ea580c', textTransform: 'uppercase' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f97316' }} />Urgente
              </span>
            )}
            {isSig && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: isCompleted ? '#059669' : '#0d9488', textTransform: 'uppercase' }}>
                {isCompleted && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                {getSignatureBadge(notification)}
              </span>
            )}
            {notification.metadata?.tribunal && (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                {String(notification.metadata.tribunal)}
              </span>
            )}
          </div>

          {/* Título */}
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {notification.title}
          </p>
          {/* Mensagem */}
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {notification.message}
          </p>

          {/* Progresso de assinatura com contagem */}
          {isSig && (() => {
            const p = getSignatureProgress(notification);
            if (!p) return null;
            return (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: '#64748b' }}>
                    {p.signedCount} de {p.totalSigners} {p.totalSigners === 1 ? 'assinatura' : 'assinaturas'}
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: accent }}>{p.pct}%</span>
                </div>
                <div style={{ height: 4, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${p.pct}%`, background: accent, borderRadius: 999, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            );
          })()}

          {/* CTA sutil */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>
            Ver detalhes
            <ChevronRight className="w-3 h-3" />
          </div>
        </div>

        {/* Fechar */}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: '#cbd5e1' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#cbd5e1'; }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Barra de countdown */}
      <div style={{ height: 2, background: '#f1f5f9', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            background: accent,
            opacity: 0.5,
            animation: `shrinkBar ${POPUP_DURATION}ms linear forwards`,
          }}
        />
      </div>

      <style>{`
        @keyframes shrinkBar {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>
  );
});
PopupItem.displayName = 'PopupItem';

interface PopupContainerProps {
  notifications: UserNotification[];
  onDismiss: (id: string) => void;
  onNavigate: (n: UserNotification) => void;
  getIcon: (n: UserNotification) => React.ReactNode;
  getIconBgColor: (n: UserNotification) => string;
  isSignatureNotification: (n: UserNotification) => boolean;
  getSignatureBadge: (n: UserNotification) => string;
  getSignatureProgress: (n: UserNotification) => { signedCount: number; totalSigners: number; pct: number } | null;
}

const PopupContainer: React.FC<PopupContainerProps> = (props) => (
  <div className="fixed bottom-5 right-5 z-[2147483647] flex flex-col-reverse items-end gap-2.5 pointer-events-none">
    <style>{`
      @keyframes slideInRight {
        from { transform: translateX(calc(100% + 24px)); opacity: 0; }
        to   { transform: translateX(0); opacity: 1; }
      }
    `}</style>
    {props.notifications.map((n) => (
      <div key={n.id} style={{ animation: 'slideInRight 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>
        <PopupItem
          notification={n}
          onDismiss={props.onDismiss}
          onNavigate={props.onNavigate}
          getIcon={props.getIcon}
          getIconBgColor={props.getIconBgColor}
          isSignatureNotification={props.isSignatureNotification}
          getSignatureBadge={props.getSignatureBadge}
          getSignatureProgress={props.getSignatureProgress}
        />
      </div>
    ))}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────
   MAIN NOTIFICATION BELL
───────────────────────────────────────────────────────────────────────── */

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigateToModule }) => {
  const { user } = useAuth();
  const { userRole, loading: permissionsLoading } = usePermissions();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const MAX_POPUPS = 5;
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('notification_sound') !== 'false';
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const isInitialLoadRef = useRef(true); // evita som na carga inicial da página
  const [popupNotifications, setPopupNotifications] = useState<UserNotification[]>([]);
  const processedNotificationIds = useRef<Set<string>>(new Set());
  const processedNotificationKeys = useRef<Set<string>>(new Set());

  // Ref espelhando soundEnabled — evita recriar canal realtime a cada toggle de som
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  // Throttle de som: máx 1 beep a cada 3 s independente de quantas notificações cheguem
  const lastSoundRef = useRef(0);

  // Fila para batching: notificações chegando em rajada são processadas juntas num único setState
  const pendingQueue = useRef<UserNotification[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pushNotifications.initialize().catch(() => {});
  }, []);

  // Desbloqueia AudioContext no primeiro gesto do usuário (política do navegador)
  useEffect(() => {
    const unlock = () => {
      if (sharedAudioContext && sharedAudioContext.state === 'suspended') {
        sharedAudioContext.resume().catch(() => {});
      }
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const normalizeRoleKey = useCallback((role?: string | null) => {
    if (!role) return '';
    return role
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }, []);

  const canSeeIntimacoes = !permissionsLoading && ['administrador', 'admin', 'advogado'].includes(normalizeRoleKey(userRole));

  const isIntimationNotification = useCallback((notification: UserNotification) => {
    if (notification.type === 'intimation_new') return true;
    if (notification.intimation_id) return true;
    const originalType = String(notification.metadata?.original_type ?? '');
    if (originalType === 'intimation_urgent') return true;
    if (originalType.includes('intimation')) return true;
    return false;
  }, []);

  const unreadNotifications = notifications.filter(n => !n.read);
  const unreadCount = unreadNotifications.length;

  const isSignatureNotification = (notification: UserNotification) => {
    return notification.type === 'signature_completed' || Boolean(notification.metadata?.signature_type);
  };

  const getNotificationDedupeKey = useCallback((notification: UserNotification) => {
    const signatureType = notification.metadata?.signature_type;
    const requestId = notification.metadata?.request_id;
    if ((notification.type === 'signature_completed' || signatureType === 'completed') && requestId) {
      return `signature_completed:${String(requestId)}`;
    }
    return `id:${notification.id}`;
  }, []);

  const dedupeNotifications = useCallback((items: UserNotification[]) => {
    const map = new Map<string, UserNotification>();
    for (const n of items) {
      const key = getNotificationDedupeKey(n);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, n);
        continue;
      }
      const existingTs = new Date((existing as any).created_at ?? 0).getTime();
      const nextTs = new Date((n as any).created_at ?? 0).getTime();
      if (Number.isFinite(nextTs) && nextTs >= existingTs) {
        map.set(key, n);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aTs = new Date((a as any).created_at ?? 0).getTime();
      const bTs = new Date((b as any).created_at ?? 0).getTime();
      return bTs - aTs;
    });
  }, [getNotificationDedupeKey]);

  const getSignatureBadge = (notification: UserNotification) => {
    const signatureType = notification.metadata?.signature_type;
    if (signatureType === 'completed') return 'CONCLUÍDA';
    if (signatureType === 'partial') return 'PARCIAL';
    return 'ASSINATURA';
  };

  const getSignatureProgress = (notification: UserNotification) => {
    const signedCount = Number(notification.metadata?.signed_count ?? 0);
    const totalSigners = Number(notification.metadata?.total_signers ?? 0);
    if (!Number.isFinite(signedCount) || !Number.isFinite(totalSigners) || totalSigners <= 0) {
      return null;
    }
    const pct = Math.max(0, Math.min(100, Math.round((signedCount / totalSigners) * 100)));
    return { signedCount, totalSigners, pct };
  };

  const getSignatureAccent = (notification: UserNotification) => {
    return notification.metadata?.signature_type === 'completed' ? 'emerald' : 'teal';
  };

  // Carregar notificações
  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const data = await userNotificationService.listNotifications(user.id);
      const normalized = dedupeNotifications(data).slice(0, 50);
      const filtered = canSeeIntimacoes ? normalized : normalized.filter((n) => !isIntimationNotification(n));

      const unreadCount = filtered.filter(n => !n.read).length;
      // Só toca som em novas notificações APÓS a carga inicial (evita AudioContext bloqueado)
      if (!isInitialLoadRef.current && unreadCount > prevCountRef.current && soundEnabled) {
        // Se a notificação mais recente é e-mail, usa o chime suave.
        const newest = filtered.find((n) => !n.read);
        playNotificationSound(newest?.type === 'email_new' ? 'email' : 'default');
      }
      isInitialLoadRef.current = false;
      prevCountRef.current = unreadCount;

      setNotifications(filtered); // Limitar a 50
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, soundEnabled, dedupeNotifications, canSeeIntimacoes, isIntimationNotification]);

  // Processa toda a fila pendente num único ciclo de setState (evita N re-renders por rajada)
  const flushPending = useCallback(() => {
    const queued = pendingQueue.current.splice(0);
    if (!queued.length) return;

    setNotifications(prev => {
      const next = dedupeNotifications([...queued, ...prev]).slice(0, 50);
      // Mantém prevCountRef em dia com o que chegou pelo realtime, senão o polling
      // de 60s vê "unread subiu" e RE-toca o som (causa de som dobrado atrasado).
      prevCountRef.current = next.filter(n => !n.read).length;
      return next;
    });

    setPopupNotifications(prev => {
      let next = [...prev];
      for (const n of queued) {
        const key = getNotificationDedupeKey(n);
        if (!next.some(x => getNotificationDedupeKey(x) === key)) {
          next.push(n);
        }
      }
      return next.slice(-MAX_POPUPS);
    });

    // Som throttled: 1 beep por rajada, no máximo 1 a cada 3 s. E-mail toca o
    // chime suave; só usa o som padrão se a rajada tiver algo que não seja e-mail.
    const now = Date.now();
    if (soundEnabledRef.current && now - lastSoundRef.current >= 3000) {
      lastSoundRef.current = now;
      const allEmail = queued.every((n) => n.type === 'email_new');
      playNotificationSound(allEmail ? 'email' : 'default');
    }

    for (const n of queued) {
      showBrowserNotification(n).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedupeNotifications, getNotificationDedupeKey]);

  // Toggle som
  const toggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    localStorage.setItem('notification_sound', String(newValue));
  };

  // Marcar como lida
  const markAsRead = async (id: string) => {
    try {
      await userNotificationService.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {}
  };

  // Marcar todas como lidas
  const markAllAsRead = async () => {
    if (!user?.id) return;
    try {
      await userNotificationService.markAllAsRead(user.id);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  // Deletar notificação
  const deleteNotification = async (id: string) => {
    try {
      await userNotificationService.deleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {}
  };

  // Navegar para item
  const handleClick = (notification: UserNotification) => {
    console.log('🖱️ Clique na notificação:', notification.id, notification.type, 'intimation_id:', notification.intimation_id, 'metadata:', notification.metadata);
    console.log('🖱️ isSignature:', isSignatureNotification(notification), 'request_id:', notification.metadata?.request_id);
    markAsRead(notification.id);

    if (!onNavigateToModule) {
      console.log('⚠️ onNavigateToModule não definido');
      setIsOpen(false);
      return;
    }

    // Preferir navegação por tipo (evita que requirement_id em prazo/agenda mude o destino)
    if (isSignatureNotification(notification)) {
      const requestId = notification.metadata?.request_id;
      console.log('➡️ Navegando para assinaturas, requestId:', requestId);
      if (requestId) {
        onNavigateToModule('assinaturas', { mode: 'details', requestId: String(requestId) });
      } else {
        onNavigateToModule('assinaturas');
      }
    } else if (notification.type === 'requirement_alert' && notification.requirement_id) {
      console.log('➡️ Navegando para requerimentos');
      onNavigateToModule('requerimentos', { mode: 'details', entityId: notification.requirement_id });
    } else if (notification.intimation_id || notification.type === 'intimation_new') {
      console.log('➡️ Navegando para intimacoes');
      onNavigateToModule('intimacoes');
    } else if (notification.type === 'deadline_assigned' || notification.type === 'deadline_reminder') {
      console.log('➡️ Navegando para prazos, deadlineId:', notification.deadline_id);
      onNavigateToModule('prazos', notification.deadline_id ? { entityId: notification.deadline_id } : undefined);
    } else if (notification.type === 'appointment_assigned' || notification.type === 'appointment_reminder') {
      console.log('➡️ Navegando para agenda, appointmentId:', notification.appointment_id);
      onNavigateToModule('agenda', notification.appointment_id ? { entityId: notification.appointment_id } : undefined);
    } else if (notification.type === 'chat_message' || notification.metadata?.chat_room_id) {
      const roomId = notification.metadata?.chat_room_id;
      console.log('➡️ Navegando para chat, sala:', roomId);
      onNavigateToModule('chat', roomId ? { roomId: String(roomId) } : {});
    } else if (notification.type === 'mention' && (notification.deadline_id || notification.metadata?.deadline_id)) {
      // Menção em comentário de prazo: abrir o prazo
      const deadlineId = notification.deadline_id || notification.metadata?.deadline_id;
      console.log('➡️ Navegando para prazos (menção em comentário):', deadlineId);
      onNavigateToModule('prazos', { entityId: String(deadlineId) });
    } else if (notification.type === 'feed_like' || notification.type === 'feed_comment' || notification.type === 'mention' || notification.type === 'poll_invite') {
      // Notificação de feed: abrir modal do post específico
      const postId = notification.metadata?.post_id;
      console.log('➡️ Abrindo modal do post:', postId);
      if (postId) {
        onNavigateToModule('feed', { openPostModal: postId });
      } else {
        onNavigateToModule('feed');
      }
    } else if (notification.type === 'profile_update_request') {
      const clientId = notification.metadata?.client_id;
      if (clientId) {
        onNavigateToModule('clientes', { mode: 'details', entityId: String(clientId) });
      } else {
        onNavigateToModule('clientes');
      }
    } else if (notification.type === 'email_new') {
      const emailId = notification.metadata?.email_id;
      console.log('➡️ Navegando para email, emailId:', emailId);
      onNavigateToModule('email', emailId ? { emailId: String(emailId) } : undefined);
    } else if (notification.type === 'access_request') {
      // Admin recebeu solicitação de acesso → abre Configurações > Solicitações
      console.log('➡️ Navegando para configuracoes > access_requests');
      onNavigateToModule('configuracoes', { section: 'access_requests' });
    } else if (notification.type === 'access_request_resolved') {
      // Usuário foi notificado da resolução → abre o módulo que foi solicitado se tiver
      const moduleKey = notification.metadata?.module_key;
      console.log('➡️ Solicitação resolvida, module_key:', moduleKey);
      if (moduleKey) {
        onNavigateToModule(moduleKey as any);
      }
    } else if (notification.type === 'signature_pending_self') {
      const signerId = notification.metadata?.signer_id;
      console.log('➡️ Navegando para assinaturas (self-pending), signerId:', signerId);
      onNavigateToModule('assinaturas');
    } else if (notification.type === 'process_created' || notification.type === 'process_updated' || notification.type === 'execution_pending' || notification.process_id) {
      const processId = notification.process_id;
      console.log('➡️ Navegando para processos, processId:', processId);
      onNavigateToModule('processos', processId ? { mode: 'details', entityId: String(processId) } : undefined);
    } else if (notification.requirement_id) {
      console.log('➡️ Navegando para requerimentos');
      onNavigateToModule('requerimentos', { mode: 'details', entityId: notification.requirement_id });
    } else {
      console.log('⚠️ Nenhuma navegação definida para esta notificação');
    }
    
    setIsOpen(false);
  };

  const showBrowserNotification = async (notification: UserNotification) => {
    console.log('🔔 showBrowserNotification chamado para:', notification.id);
    if (typeof window === 'undefined') {
      console.log('⚠️ window undefined');
      return;
    }
    // Só notifica no SO quando a aba está em SEGUNDO PLANO. Com o app em foco, o
    // popup interno + o beep já avisam — disparar a notificação do SO (que toca o
    // som do Windows) faria o usuário ouvir DOIS sons. Em background o beep do
    // Web Audio nem soa (aba suspensa), então a do SO é a única.
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      return;
    }
    if (!('Notification' in window)) {
      console.log('⚠️ Notification API não suportada');
      return;
    }
    console.log('🔔 Permissão de notificação:', Notification.permission);
    if (Notification.permission !== 'granted') {
      console.log('⚠️ Permissão não concedida, solicitando...');
      const result = await Notification.requestPermission();
      console.log('🔔 Resultado da solicitação:', result);
      if (result !== 'granted') return;
    }

    const isUrgent = notification.metadata?.urgency === 'alta' || notification.metadata?.urgency === 'critica';
    const signature = isSignatureNotification(notification);

    let data: any = { action: 'navigate' };
    if (signature && notification.metadata?.request_id) {
      data = {
        action: 'navigate',
        module: 'assinaturas',
        params: { mode: 'details', requestId: String(notification.metadata.request_id) },
      };
    }

    const dedupeKey = getNotificationDedupeKey(notification);

    await pushNotifications.showNotification({
      title: notification.title,
      body: notification.message,
      tag: `user-notification-${dedupeKey}`,
      data,
      requireInteraction: signature || isUrgent,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    });
  };

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Ao abrir um e-mail no módulo, o EmailModule dispara 'email-notif-read'.
  // Removemos imediatamente a notificação de "novo e-mail" correspondente do sino
  // (e do popup) — não faz sentido seguir pendente depois de lida.
  useEffect(() => {
    const onEmailRead = (e: Event) => {
      const emailId = (e as CustomEvent).detail?.emailId;
      if (!emailId) return;
      const matches = (n: UserNotification) =>
        n.type === 'email_new' && String(n.metadata?.email_id) === String(emailId);
      setNotifications(prev => prev.map(n => (matches(n) ? { ...n, read: true } : n)));
      setPopupNotifications(prev => prev.filter(n => !matches(n)));
    };
    window.addEventListener('email-notif-read', onEmailRead);
    return () => window.removeEventListener('email-notif-read', onEmailRead);
  }, []);

  // Carregar ao montar e polling
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000); // 60s — realtime já traz as novas
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Realtime: escutar novas notificações
  // IMPORTANTE: soundEnabled propositalmente fora das deps — lido via soundEnabledRef para evitar
  // recriar o canal a cada toggle de som (o que causava canais zumbis e processamento duplicado).
  useEffect(() => {
    if (!user?.id) return;

    // Nome único do canal para evitar conflitos com StrictMode
    const channelName = `user_notifications_${user.id}_${Date.now()}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as UserNotification;

          if (!canSeeIntimacoes && isIntimationNotification(newNotification)) {
            return;
          }

          const dedupeKey = getNotificationDedupeKey(newNotification);

          // Evitar processar a mesma notificação duas vezes (StrictMode)
          // Cap em 1000 entradas para evitar vazamento de memória em sessões longas
          if (processedNotificationIds.current.size > 1000) {
            processedNotificationIds.current.clear();
          }
          if (processedNotificationIds.current.has(newNotification.id)) return;
          processedNotificationIds.current.add(newNotification.id);

          if (processedNotificationKeys.current.size > 1000) {
            processedNotificationKeys.current.clear();
          }
          if (processedNotificationKeys.current.has(dedupeKey)) return;
          processedNotificationKeys.current.add(dedupeKey);

          // Enfileira a notificação e agenda flush em lote (150 ms de debounce)
          // Notificações em rajada são processadas num único setState em vez de N re-renders
          pendingQueue.current.push(newNotification);
          if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
          flushTimerRef.current = setTimeout(flushPending, 150);
        }
      )
      .subscribe();

    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canSeeIntimacoes, isIntimationNotification, getNotificationDedupeKey, flushPending]);

  // Ícone por tipo e urgência
  const getIcon = (notification: UserNotification) => {
    const urgency = notification.metadata?.urgency;
    const isUrgent = urgency === 'alta' || urgency === 'critica';
    
    switch (notification.type) {
      case 'deadline_assigned':
      case 'deadline_reminder':
        return <Clock className="w-4 h-4 text-amber-500" />;
      case 'appointment_assigned':
      case 'appointment_reminder':
        return <Calendar className="w-4 h-4 text-blue-500" />;
      case 'requirement_alert':
        return <Briefcase className="w-4 h-4 text-indigo-500" />;
      case 'intimation_new':
        return isUrgent
          ? <AlertTriangle className="w-4 h-4 text-red-500" />
          : <FileText className="w-4 h-4 text-purple-500" />;
      case 'process_created':
      case 'process_updated':
        return <Briefcase className="w-4 h-4 text-cyan-500" />;
      case 'execution_pending':
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      case 'signature_completed':
      case 'signature_pending_self':
        return <PenTool className="w-4 h-4 text-emerald-500" />;
      case 'poll_invite':
        return <Bell className="w-4 h-4 text-fuchsia-500" />;
      case 'mention':
        return <Bell className="w-4 h-4 text-blue-500" />;
      case 'feed_like':
        return <Check className="w-4 h-4 text-pink-500" />;
      case 'feed_comment':
        return <ChevronRight className="w-4 h-4 text-sky-500" />;
      case 'profile_update_request':
        return <UserCheck className="w-4 h-4 text-orange-500" />;
      case 'email_new':
        return <Mail className="w-4 h-4 text-amber-600" />;
      default:
        if (isSignatureNotification(notification)) {
          return <PenTool className="w-4 h-4 text-emerald-500" />;
        }
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  const getIconBgColor = (notification: UserNotification) => {
    const urgency = notification.metadata?.urgency;
    if (notification.type === 'profile_update_request') return 'bg-orange-100';
    if (notification.type === 'email_new') return 'bg-amber-100';
    if (isSignatureNotification(notification)) return 'bg-emerald-100';
    if (urgency === 'critica') return 'bg-red-100';
    if (urgency === 'alta') return 'bg-orange-100';
    if (!notification.read) return 'bg-amber-100';
    return 'bg-slate-100';
  };

  // Tempo relativo
  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'agora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="relative" ref={panelRef}>

      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
        aria-label="Notificações"
      >
        <Bell className="w-5 h-5 text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel - estilo Facebook/Instagram */}
      {isOpen && (
        <>
          {/* Backdrop móvel para fechar ao clicar fora */}
          <div className="fixed inset-0 z-[90] sm:hidden bg-black/20 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          
          {/* Container Mobile (Fixed) */}
          <div className="fixed left-4 right-4 top-[70px] z-[100] bg-white rounded-xl shadow-2xl border border-[#e7e5df] overflow-hidden sm:hidden flex flex-col max-h-[calc(100vh-100px)] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">Notificações</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                  >
                    Ler todas
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-full hover:bg-slate-200 transition"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto overscroll-contain flex-1">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : unreadNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Bell className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma notificação</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {unreadNotifications.slice(0, 20).map((notification) => (
                    <div
                      key={notification.id}
                      className={`group flex items-start gap-3 px-4 py-3 active:bg-amber-50/60 transition ${
                        !notification.read ? 'bg-amber-50/50' : ''
                      }`}
                      onClick={() => handleClick(notification)}
                    >
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getIconBgColor(notification)}`}>
                        {getIcon(notification)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 justify-between">
                          <p className={`text-sm ${!notification.read ? 'font-semibold text-slate-900' : 'text-slate-700'} line-clamp-2`}>
                            {notification.title}
                          </p>
                          <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2">
                            {getRelativeTime(notification.created_at)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2 mt-1">{notification.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 flex-shrink-0">
                <button
                  onClick={() => {
                    if (onNavigateToModule) onNavigateToModule('notificacoes');
                    setIsOpen(false);
                  }}
                  className="w-full text-center text-sm text-amber-700 font-medium py-2 bg-[#f8f7f5] border border-amber-100 rounded-lg shadow-sm active:bg-amber-50"
                >
                  Ver todas as notificações
                </button>
              </div>
            )}
          </div>

          {/* Container Desktop (Absolute) */}
          <div className="hidden sm:block absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-[#e7e5df] z-50 overflow-hidden origin-top-right animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
          <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 truncate">Notificações</h3>
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={toggleSound}
                className="p-1.5 rounded-full hover:bg-slate-200 transition hidden sm:block"
                title={soundEnabled ? 'Desativar som' : 'Ativar som'}
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-slate-600" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-amber-600 hover:text-amber-700 font-medium whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Marcar todas como lidas</span>
                  <span className="sm:hidden">Ler todas</span>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-200 transition"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          </div>

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
              {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : unreadNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Bell className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma notificação</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {unreadNotifications.slice(0, 10).map((notification) => (
                  <div
                    key={notification.id}
                    className={`group relative flex items-start gap-3 px-4 py-3 hover:bg-amber-50/40 cursor-pointer transition ${
                      !notification.read ? 'bg-amber-50/50' : ''
                    }`}
                    onClick={() => handleClick(notification)}
                  >
                    {/* Faixa de não lida (à esquerda) */}
                    {!notification.read && (
                      <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />
                    )}

                    {/* Icon */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getIconBgColor(notification)}`}>
                      {getIcon(notification)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Título + horário alinhado à direita */}
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-snug ${!notification.read ? 'font-semibold text-slate-900' : 'text-slate-700'} line-clamp-2`}>
                          {notification.title}
                        </p>
                        <span className="flex-shrink-0 text-[10.5px] text-slate-400 whitespace-nowrap pt-0.5">
                          {getRelativeTime(notification.created_at)}
                        </span>
                      </div>

                      {/* Badges (tribunal / urgência / assinatura) numa linha só */}
                      {(notification.metadata?.tribunal ||
                        notification.metadata?.urgency === 'alta' ||
                        notification.metadata?.urgency === 'critica' ||
                        isSignatureNotification(notification)) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {notification.metadata?.tribunal && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-200 text-slate-600 rounded">
                              {notification.metadata.tribunal}
                            </span>
                          )}
                          {notification.metadata?.urgency === 'alta' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 rounded">
                              ALTA
                            </span>
                          )}
                          {notification.metadata?.urgency === 'critica' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded animate-pulse">
                              CRÍTICA
                            </span>
                          )}
                          {isSignatureNotification(notification) && (
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded ${
                                getSignatureAccent(notification) === 'emerald'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-teal-100 text-teal-700'
                              }`}
                            >
                              {getSignatureBadge(notification)}
                            </span>
                          )}
                        </div>
                      )}

                      <p className="text-xs text-slate-500 line-clamp-2 mt-1">{notification.message}</p>

                      {isSignatureNotification(notification) && (() => {
                        const progress = getSignatureProgress(notification);
                        if (!progress) return null;
                        return (
                          <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                getSignatureAccent(notification) === 'emerald' ? 'bg-emerald-500' : 'bg-teal-500'
                              }`}
                              style={{ width: `${progress.pct}%` }}
                            />
                          </div>
                        );
                      })()}
                    </div>

                    {/* Actions (aparecem no hover) */}
                    <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      {!notification.read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notification.id);
                          }}
                          className="p-1 rounded hover:bg-amber-100"
                          title="Marcar como lida"
                        >
                          <Check className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notification.id);
                        }}
                        className="p-1 rounded hover:bg-red-100"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-slate-100 px-3 sm:px-4 py-3 bg-slate-50 sticky bottom-0">
                <button
                  onClick={() => {
                    if (onNavigateToModule) onNavigateToModule('notificacoes');
                    setIsOpen(false);
                  }}
                  className="w-full text-center text-sm text-amber-700 hover:text-amber-800 font-medium py-1 bg-[#f8f7f5] border border-amber-100 rounded-lg shadow-sm"
                >
                  {notifications.length > 10 ? 'Ver todas as notificações' : 'Ver notificações'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {/* Popup de notificações — auto-dismiss 10s */}
      {popupNotifications.length > 0 && createPortal(
        <PopupContainer
          notifications={popupNotifications}
          onDismiss={(id) => setPopupNotifications(prev => prev.filter(n => n.id !== id))}
          onNavigate={(notification) => {
            handleClick(notification);
            setPopupNotifications(prev => prev.filter(n => n.id !== notification.id));
          }}
          getIcon={getIcon}
          getIconBgColor={getIconBgColor}
          isSignatureNotification={isSignatureNotification}
          getSignatureBadge={getSignatureBadge}
          getSignatureProgress={getSignatureProgress}
        />,
        document.body
      )}
    </div>
  );
};

export default NotificationBell;
