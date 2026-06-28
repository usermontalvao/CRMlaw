import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';
import { isNotifySoundMuted, setNotifySoundMuted, playNotificationSound } from '../../utils/notificationSound';
import { useToastContext } from '../../contexts/ToastContext';
import type { StaffPushState } from './hooks/useStaffPush';

/**
 * Sino unificado de notificações do cabeçalho: agrupa "som das notificações"
 * (persistido em localStorage) e "push do navegador" num único ícone com menu.
 * Dono do próprio estado de UI (menu aberto, ref do botão, mute do som) — nada
 * disso precisa subir ao módulo. O ícone reflete o estado geral: toca (BellRing)
 * com push ligado, sino simples só com som, e BellOff quando tudo está desligado.
 * O estado/ação do push vêm de cima (useStaffPush), já que dependem de permissão
 * do navegador e são compartilhados com o resto do módulo.
 */
export const WaNotifyBell: React.FC<{
  pushState: StaffPushState;
  onTogglePush: () => void;
}> = ({ pushState, onTogglePush }) => {
  const toast = useToastContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => isNotifySoundMuted());
  const btnRef = useRef<HTMLButtonElement>(null);

  const pushSupported = pushState !== 'unsupported' && pushState !== 'unknown';
  const pushOn = pushState === 'on';
  const soundOn = !soundMuted;
  const active = soundOn || pushOn;
  const Icon = pushOn ? BellRing : soundOn ? Bell : BellOff;

  const toggleSound = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    setNotifySoundMuted(next);
    if (!next) { playNotificationSound(); toast.success('Som das notificações ativado'); }
    else toast.info('Som das notificações silenciado');
  };

  const row = 'w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-slate-700 hover:bg-amber-50 transition text-left';
  const pill = (on: boolean) => `ml-auto text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${on ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`;
  const r = btnRef.current?.getBoundingClientRect();
  const menuTop = r ? r.bottom + 6 : 0;
  const menuRight = r ? Math.max(8, window.innerWidth - r.right) : 8;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setMenuOpen(o => !o)}
        title="Notificações"
        aria-haspopup="menu" aria-expanded={menuOpen}
        className={`flex items-center justify-center w-7 h-7 rounded-full transition ${active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#f3f2ef] text-slate-400 hover:bg-slate-200'}`}>
        <Icon size={15} />
      </button>
      {menuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
          <div role="menu" style={{ position: 'fixed', top: menuTop, right: menuRight }}
            className="z-[71] w-[min(17rem,calc(100vw-1rem))] rounded-xl bg-white shadow-xl border border-[#e7e5df] py-1.5 overflow-hidden">
            <p className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Notificações</p>
            <button className={row} onClick={toggleSound}>
              {soundOn ? <Bell size={16} className="text-amber-500 shrink-0" /> : <BellOff size={16} className="text-slate-400 shrink-0" />}
              <span className="min-w-0">
                <span className="block leading-tight">Som das notificações</span>
                <span className="block text-[11px] text-slate-400">Toca ao chegar mensagem nas suas conversas</span>
              </span>
              <span className={pill(soundOn)}>{soundOn ? 'ON' : 'OFF'}</span>
            </button>
            {pushSupported && (
              <button className={row} onClick={onTogglePush} disabled={pushState === 'busy'}>
                {pushState === 'busy' ? <Loader2 size={16} className="animate-spin text-slate-400 shrink-0" /> : pushOn ? <BellRing size={16} className="text-amber-500 shrink-0" /> : <BellOff size={16} className="text-slate-400 shrink-0" />}
                <span className="min-w-0">
                  <span className="block leading-tight">Notificações no navegador</span>
                  <span className="block text-[11px] text-slate-400">Avisa mesmo com a aba fechada</span>
                </span>
                <span className={pill(pushOn)}>{pushOn ? 'ON' : 'OFF'}</span>
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
};
