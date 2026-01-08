import React, { useState, useEffect } from 'react';
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
  FileSignature,
  FileText,
  MessageCircle,
  CheckSquare,
} from 'lucide-react';
import type { ModuleName } from '../../contexts/NavigationContext';
import { supabase } from '../../config/supabase';
import { useAuth } from '../../contexts/AuthContext';

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
  moduleKey: string;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Layers className="w-5 h-5" />, moduleKey: 'dashboard' },
  { id: 'leads', label: 'Leads', icon: <Target className="w-5 h-5" />, moduleKey: 'leads' },
  { id: 'clientes', label: 'Clientes', icon: <Users className="w-5 h-5" />, moduleKey: 'clientes' },
  { id: 'documentos', label: 'Documentos', icon: <Library className="w-5 h-5" />, moduleKey: 'documentos' },
  { id: 'assinaturas', label: 'Assinaturas', icon: <FileSignature className="w-5 h-5" />, moduleKey: 'assinaturas' },
  { id: 'processos', label: 'Processos', icon: <Scale className="w-5 h-5" />, moduleKey: 'processos' },
  { id: 'requerimentos', label: 'Requerimentos', icon: <Briefcase className="w-5 h-5" />, moduleKey: 'requerimentos' },
  { id: 'prazos', label: 'Prazos', icon: <AlarmClock className="w-5 h-5" />, moduleKey: 'prazos' },
  { id: 'intimacoes', label: 'Intimações', icon: <Bell className="w-5 h-5" />, moduleKey: 'intimacoes' },
  { id: 'financeiro', label: 'Financeiro', icon: <PiggyBank className="w-5 h-5" />, moduleKey: 'financeiro' },
  { id: 'agenda', label: 'Agenda', icon: <Calendar className="w-5 h-5" />, moduleKey: 'agenda' },
  { id: 'tarefas', label: 'Tarefas', icon: <CheckSquare className="w-5 h-5" />, moduleKey: 'tarefas' },
  { id: 'peticoes', label: 'Petições', icon: <FileText className="w-5 h-5" />, moduleKey: 'peticoes' },
  { id: 'chat', label: 'Chat', icon: <MessageCircle className="w-5 h-5" />, moduleKey: 'chat' },
];

export const MobileSidebar: React.FC<MobileSidebarProps> = ({
  isOpen,
  activeModule,
  onNavigate,
  onClose,
  onOpenProfile,
  logoUrl,
}) => {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const normalizeRole = (role: string) =>
    role
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  useEffect(() => {
    const loadPermissions = async () => {
      if (!user?.id) return;

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .single();

        const normalizedRole = normalizeRole(profile?.role || '');

        if (normalizedRole === 'administrador') {
          const allPerms: Record<string, boolean> = {};
          navItems.forEach((item) => {
            allPerms[item.moduleKey] = true;
          });
          setPermissions(allPerms);
          return;
        }

        const { data: rolePerms } = await supabase
          .from('role_permissions')
          .select('module, can_view, can_create, can_edit, can_delete')
          .eq('role', normalizedRole);

        const perms: Record<string, boolean> = {};
        rolePerms?.forEach((perm) => {
          const hasAnyPermission = perm.can_view || perm.can_create || perm.can_edit || perm.can_delete;
          perms[perm.module] = hasAnyPermission;
        });

        setPermissions(perms);
      } catch (err) {
        console.error('Erro ao carregar permissões:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPermissions();
  }, [user?.id]);

  const visibleItems = loading
    ? []
    : navItems.filter((item) => {
        if (item.moduleKey === 'dashboard') return true;
        return permissions[item.moduleKey] === true;
      });

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
            {visibleItems.map((item) => (
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
