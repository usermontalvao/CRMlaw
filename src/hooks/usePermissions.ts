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

export const usePermissions = () => {
  const { user } = useAuth();
  const [userRole, setUserRole] = useState<string>('');
  const [permissions, setPermissions] = useState<PermissionsCache>({});
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
        if (roleValue) {
          await loadPermissions(normalizeRole(roleValue));
        } else {
          setPermissions({});
        }
      } catch (err) {
        console.error('Erro ao carregar cargo do usuário:', err);
        setUserRole('');
        setPermissions({});
      } finally {
        setLoading(false);
      }
    };

    loadUserRole();
  }, [user?.id]);

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
    [permissions, isAdmin]
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
  };
};

export default usePermissions;
