import React from 'react';
import {
  Scale,
  Users,
  Calendar,
  Bell,
  UserCog,
  Target,
  Layers,
  Library,
  Briefcase,
  AlarmClock,
  PiggyBank,
} from 'lucide-react';
import type { ModuleName } from '../../contexts/NavigationContext';

interface SidebarProps {
  activeModule: ModuleName;
  onNavigate: (module: ModuleName) => void;
  onOpenProfile: () => void;
  logoUrl?: string;
}

interface NavItem {
  id: ModuleName;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Layers className="w-5 h-5 mb-1.5" /> },
  { id: 'leads', label: 'Leads', icon: <Target className="w-5 h-5 mb-1.5" /> },
  { id: 'clientes', label: 'Clientes', icon: <Users className="w-5 h-5 mb-1.5" /> },
  { id: 'documentos', label: 'Documentos', icon: <Library className="w-5 h-5 mb-1.5" /> },
  { id: 'processos', label: 'Processos', icon: <Scale className="w-5 h-5 mb-1.5" /> },
  { id: 'requerimentos', label: 'Requerimentos', icon: <Briefcase className="w-5 h-5 mb-1.5" /> },
  { id: 'prazos', label: 'Prazos', icon: <AlarmClock className="w-5 h-5 mb-1.5" /> },
  { id: 'intimacoes', label: 'Intimações', icon: <Bell className="w-5 h-5 mb-1.5" /> },
  { id: 'financeiro', label: 'Financeiro', icon: <PiggyBank className="w-5 h-5 mb-1.5" /> },
  { id: 'agenda', label: 'Agenda', icon: <Calendar className="w-5 h-5 mb-1.5" /> },
];

const NavButton: React.FC<{
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}> = ({ item, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg transition-all border-l-4 ${
      isActive
        ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
        : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
    }`}
  >
    {item.icon}
    <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
  </button>
);

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onNavigate,
  onOpenProfile,
  logoUrl,
}) => {
  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-screen w-20 bg-slate-900 flex-col items-center py-4 z-40">
      {/* Logo */}
      <div className="mb-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
          ) : (
            <Scale className="w-7 h-7 text-white" />
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 flex flex-col items-stretch gap-1 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activeModule === item.id}
            onClick={() => onNavigate(item.id)}
          />
        ))}
      </nav>

      {/* Indicador de mais itens */}
      <div className="flex items-center justify-center py-1 border-t border-slate-800/50">
        <div className="text-slate-500 text-xs">⋮</div>
      </div>

      {/* Configurações */}
      <div className="border-t border-slate-800 py-2">
        <button
          onClick={onOpenProfile}
          className="flex flex-col items-center justify-center py-3 px-2 w-full transition-all hover:bg-slate-800"
        >
          <UserCog className="w-6 h-6 mb-1.5 text-slate-300" />
          <span className="text-[10px] font-medium text-center leading-tight text-slate-300">Perfil</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
