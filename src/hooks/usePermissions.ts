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

/**
 * RETRATO LOCAL DAS PERMISSÕES — por que ele existe.
 *
 * Este hook é montado do zero em CADA janela do produto. O CRM é uma; o Editor
 * de petições, aberto em janela/PWA própria (`/editor`), é outra; o mesmo vale
 * para qualquer aba nova. Em cada uma delas o cargo e as permissões eram
 * buscados outra vez — duas idas ao servidor —, e durante esse intervalo
 * `loading` valia `true`.
 *
 * Quem paga essa espera é o usuário: `ensurePermission` (SecurityPinContext)
 * responde "Verificando suas permissões — aguarde um instante e tente
 * novamente" enquanto o carregamento não termina, e no Editor isso acontecia
 * logo na abertura, antes de a pessoa ter feito qualquer coisa.
 *
 * O retrato resolve a corrida: o que foi lido da última vez fica guardado por
 * usuário, e a janela seguinte já nasce sabendo. A revalidação continua
 * acontecendo sempre, em segundo plano — o retrato só encurta a espera do
 * primeiro quadro, nunca substitui a leitura do servidor.
 *
 * Não é controle de acesso. A trava de verdade é a RLS do banco; isto aqui só
 * decide qual botão a tela mostra e quando ela pergunta o PIN.
 */
const SNAPSHOT_KEY = 'jurius_permissions_snapshot_v1';
/** Depois disso o retrato é velho demais para valer o primeiro quadro. */
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PermissionsSnapshot {
  userId: string;
  savedAt: number;
  role: string;
  permissions: PermissionsCache;
  overrides: ModuleOverride[];
}

function readSnapshot(userId: string): PermissionsSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as PermissionsSnapshot;
    if (!snap || snap.userId !== userId) return null;
    if (!Number.isFinite(snap.savedAt) || Date.now() - snap.savedAt > SNAPSHOT_TTL_MS) return null;
    return {
      ...snap,
      permissions: snap.permissions ?? {},
      // Override vencido não volta do retrato: ele é temporário por definição.
      overrides: (snap.overrides ?? []).filter(ov => !ov.expires_at || new Date(ov.expires_at) > new Date()),
    };
  } catch {
    return null;
  }
}

function writeSnapshot(snap: PermissionsSnapshot) {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* cota cheia ou modo privado: seguir sem retrato é só voltar ao que era */
  }
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
    let vivo = true;

    if (!user?.id) {
      setUserRole('');
      setPermissions({});
      setOverrides([]);
      setLoading(false);
      return;
    }

    const userId = user.id;

    // Primeiro quadro: o que foi lido da última vez, se ainda vale. É isto que
    // faz a janela do Editor abrir já sabendo quem pode o quê, em vez de
    // recusar a primeira ação com "Verificando suas permissões".
    const retrato = readSnapshot(userId);
    if (retrato) {
      setUserRole(retrato.role);
      setPermissions(retrato.permissions);
      setOverrides(retrato.overrides);
      setLoading(false);
    } else {
      setLoading(true);
      setUserRole('');
      setPermissions({});
    }

    (async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', userId)
          .single();

        const roleValue = profile?.role || '';

        const [perms, ovs] = await Promise.all([
          roleValue ? fetchPermissions(normalizeRole(roleValue)) : Promise.resolve<PermissionsCache>({}),
          fetchOverrides(userId),
        ]);

        if (!vivo) return;
        setUserRole(roleValue);
        setPermissions(perms);
        setOverrides(ovs);
        writeSnapshot({ userId, savedAt: Date.now(), role: roleValue, permissions: perms, overrides: ovs });
      } catch (err) {
        console.error('Erro ao carregar cargo do usuário:', err);
        if (!vivo) return;
        // Havendo retrato, ele continua valendo: uma queda de rede não pode
        // virar "este usuário não pode nada" numa tela que já estava de pé.
        if (retrato) return;
        setUserRole('');
        setPermissions({});
        setOverrides([]);
      } finally {
        if (vivo) setLoading(false);
      }
    })();

    return () => { vivo = false; };
  }, [user?.id]);

  // Overrides individuais do usuário (acesso extra concedido pelo admin)
  const fetchOverrides = async (userId: string): Promise<ModuleOverride[]> => {
    const { data, error } = await supabase
      .from('user_module_overrides')
      .select('module, can_view, expires_at')
      .eq('user_id', userId);

    if (error) throw error;

    // Filtrar overrides expirados
    const now = new Date();
    return (data ?? []).filter(ov => !ov.expires_at || new Date(ov.expires_at) > now) as ModuleOverride[];
  };

  const loadOverrides = async (userId: string) => {
    try {
      setOverrides(await fetchOverrides(userId));
    } catch (err) {
      console.error('Erro ao carregar overrides de módulo:', err);
      setOverrides([]);
    }
  };

  // Aqui havia um canal Realtime que recarregaria os overrides quando um admin
  // concedesse ou revogasse um módulo. Ele nunca funcionou: user_module_overrides
  // não está na publicação `supabase_realtime`, então o evento nunca chegou.
  //
  // Na prática os overrides já são carregados na montagem, e a expiração
  // automática logo abaixo cuida dos temporários. Para a mudança de permissão
  // valer sem recarregar a página, a tabela precisaria ser publicada de
  // propósito — é decisão de produto, não de desempenho.

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
  const fetchPermissions = async (role: string): Promise<PermissionsCache> => {
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
    return cache;
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
