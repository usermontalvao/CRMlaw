import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';

interface Permission {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

interface PermissionsCache {
  [module: string]: Permission;
}

// Overrides individuais de módulo (acesso concedido pelo admin fora do cargo)
interface ModuleOverride {
  module: string;
  can_view: boolean;
  expires_at: string | null;
}

export const usePermissions = () => {
  const { user } = useAuth();
  const [userRole, setUserRole] = useState<string>('');
  const [permissions, setPermissions] = useState<PermissionsCache>({});
  const [overrides, setOverrides] = useState<ModuleOverride[]>([]);
  const [loading, setLoading] = useState(true);

  // Normaliza o cargo para comparação
  const normalizeRole = (role: string) =>
    role
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  // Carrega o cargo do usuário atual
  useEffect(() => {
    const loadUserRole = async () => {
      setLoading(true);
      setUserRole('');
      setPermissions({});

      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .single();

        const roleValue = profile?.role || '';
        setUserRole(roleValue);

        await Promise.all([
          roleValue ? loadPermissions(normalizeRole(roleValue)) : Promise.resolve(),
          loadOverrides(user.id),
        ]);
      } catch (err) {
        console.error('Erro ao carregar cargo do usuário:', err);
        setUserRole('');
        setPermissions({});
        setOverrides([]);
      } finally {
        setLoading(false);
      }
    };

    loadUserRole();
  }, [user?.id]);

  // Carrega overrides individuais do usuário (acesso extra concedido pelo admin)
  const loadOverrides = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_module_overrides')
        .select('module, can_view, expires_at')
        .eq('user_id', userId);

      if (error) throw error;

      // Filtrar overrides expirados
      const now = new Date();
      const active = (data ?? []).filter(ov =>
        !ov.expires_at || new Date(ov.expires_at) > now
      );
      setOverrides(active as ModuleOverride[]);
    } catch (err) {
      console.error('Erro ao carregar overrides de módulo:', err);
      setOverrides([]);
    }
  };

  // Realtime: recarregar overrides quando admin inserir/atualizar/deletar
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`user-module-overrides-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_module_overrides',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          loadOverrides(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Expiração automática: agenda um timeout para remover overrides vencidos sem precisar recarregar a página
  useEffect(() => {
    const temporaries = overrides.filter(ov => ov.expires_at);
    if (!temporaries.length || !user?.id) return;

    // Pega a expiração mais próxima
    const nearest = temporaries
      .map(ov => new Date(ov.expires_at!).getTime())
      .sort((a, b) => a - b)[0];

    const delay = nearest - Date.now();

    if (delay <= 0) {
      // Já expirou — filtra agora mesmo
      setOverrides(prev => prev.filter(ov => !ov.expires_at || new Date(ov.expires_at) > new Date()));
      return;
    }

    // Dispara 500 ms após a expiração para garantir que o timestamp já passou
    const id = setTimeout(() => {
      setOverrides(prev => prev.filter(ov => !ov.expires_at || new Date(ov.expires_at) > new Date()));
    }, delay + 500);

    return () => clearTimeout(id);
  }, [overrides, user?.id]);

  // Carrega todas as permissões do cargo
  const loadPermissions = async (role: string) => {
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('module, can_view, can_create, can_edit, can_delete')
        .eq('role', role);

      if (error) throw error;

      const cache: PermissionsCache = {};
      data?.forEach((perm) => {
        cache[perm.module] = {
          can_view: perm.can_view,
          can_create: perm.can_create,
          can_edit: perm.can_edit,
          can_delete: perm.can_delete,
        };
      });

      setPermissions(cache);
    } catch (err) {
      console.error('Erro ao carregar permissões:', err);
    }
  };

  // Verifica se o usuário é administrador (tem todas as permissões)
  const isAdmin = normalizeRole(userRole) === 'administrador';

  // Verifica permissão para um módulo e ação específica
  const hasPermission = useCallback(
    (module: string, action: 'view' | 'create' | 'edit' | 'delete'): boolean => {
      // Administrador tem todas as permissões
      if (isAdmin) return true;

      // Verificar override individual (acesso extra concedido pelo admin)
      if (action === 'view') {
        const override = overrides.find(ov => ov.module === module);
        if (override?.can_view) return true;
      }

      const modulePerm = permissions[module];
      if (!modulePerm) return false;

      switch (action) {
        case 'view':
          return modulePerm.can_view;
        case 'create':
          return modulePerm.can_create;
        case 'edit':
          return modulePerm.can_edit;
        case 'delete':
          return modulePerm.can_delete;
        default:
          return false;
      }
    },
    [permissions, overrides, isAdmin]
  );

  // Verifica se pode visualizar um módulo
  const canView = useCallback(
    (module: string) => hasPermission(module, 'view'),
    [hasPermission]
  );

  // Verifica se pode criar em um módulo
  const canCreate = useCallback(
    (module: string) => hasPermission(module, 'create'),
    [hasPermission]
  );

  // Verifica se pode editar em um módulo
  const canEdit = useCallback(
    (module: string) => hasPermission(module, 'edit'),
    [hasPermission]
  );

  // Verifica se pode excluir em um módulo
  const canDelete = useCallback(
    (module: string) => hasPermission(module, 'delete'),
    [hasPermission]
  );

  return {
    userRole,
    loading,
    isAdmin,
    hasPermission,
    canView,
    canCreate,
    canEdit,
    canDelete,
    permissions,
    overrides,
    reloadOverrides: () => user?.id ? loadOverrides(user.id) : Promise.resolve(),
  };
};

export default usePermissions;
