import React from 'react';
import {
  Scale,
  Users,
  Calendar,
  Bell,
  X,
  UserCog,
  Target,
  Layers,
  Library,
  Briefcase,
  AlarmClock,
  PiggyBank,
} from 'lucide-react';
import type { ModuleName } from '../../contexts/NavigationContext';

interface MobileSidebarProps {
  isOpen: boolean;
  activeModule: ModuleName;
  onNavigate: (module: ModuleName) => void;
  onClose: () => void;
  onOpenProfile: () => void;
  logoUrl?: string;
}

interface NavItem {
  id: ModuleName;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Layers className="w-5 h-5" /> },
  { id: 'leads', label: 'Leads', icon: <Target className="w-5 h-5" /> },
  { id: 'clientes', label: 'Clientes', icon: <Users className="w-5 h-5" /> },
  { id: 'documentos', label: 'Documentos', icon: <Library className="w-5 h-5" /> },
  { id: 'processos', label: 'Processos', icon: <Scale className="w-5 h-5" /> },
  { id: 'requerimentos', label: 'Requerimentos', icon: <Briefcase className="w-5 h-5" /> },
  { id: 'prazos', label: 'Prazos', icon: <AlarmClock className="w-5 h-5" /> },
  { id: 'intimacoes', label: 'Intimações', icon: <Bell className="w-5 h-5" /> },
  { id: 'financeiro', label: 'Financeiro', icon: <PiggyBank className="w-5 h-5" /> },
  { id: 'agenda', label: 'Agenda', icon: <Calendar className="w-5 h-5" /> },
];

export const MobileSidebar: React.FC<MobileSidebarProps> = ({
  isOpen,
  activeModule,
  onNavigate,
  onClose,
  onOpenProfile,
  logoUrl,
}) => {
  if (!isOpen) return null;

  const handleNavigate = (module: ModuleName) => {
    onNavigate(module);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="md:hidden fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside className="md:hidden fixed left-0 top-0 h-screen w-64 bg-slate-900 flex flex-col z-50 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <Scale className="w-6 h-6 text-white" />
              )}
            </div>
            <span className="text-white font-bold">CRM Jurídico</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto">
          <div className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  activeModule === item.id
                    ? 'bg-amber-600 text-white shadow-lg'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.icon}
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800 p-3">
          <button
            onClick={() => {
              onOpenProfile();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition"
          >
            <UserCog className="w-5 h-5" />
            <span className="text-sm font-medium">Configurações</span>
          </button>
        </div>
      </aside>
    </>
  );
};

export default MobileSidebar;
