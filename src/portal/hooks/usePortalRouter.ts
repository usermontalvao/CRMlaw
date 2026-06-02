/**
 * Roteamento interno do Portal — usa hash para navegar sem React Router
 * Padrão: #/portal/{rota}
 */
import { useEffect, useState, useCallback } from 'react';
import type { PortalRoute } from '../types/portal.types';

const VALID_ROUTES: PortalRoute[] = [
  'dashboard',
  'casos',
  'processos',   // alias legado — PortalApp redireciona para 'casos'
  'documentos',
  'assinar',
  'financeiro',
  'agenda',
  'mensagens',
  'notificacoes',
  'perfil',
];

interface ParsedRoute {
  route: PortalRoute;
  param?: string;
}

function parseHash(): ParsedRoute {
  if (typeof window === 'undefined') {
    return { route: 'dashboard' };
  }

  const hash = window.location.hash || '';
  const path = window.location.pathname || '';

  // Extrai o segmento após /portal/
  const fromHash = hash.split('/portal/')[1];
  const fromPath = path.split('/portal/')[1];
  const segment = (fromHash || fromPath || 'dashboard').split('?')[0].split('#')[0];

  const [route, param] = segment.split('/');
  const safeRoute = (VALID_ROUTES.includes(route as PortalRoute) ? route : 'dashboard') as PortalRoute;

  return { route: safeRoute, param };
}

export function usePortalRouter() {
  const [parsed, setParsed] = useState<ParsedRoute>(() => parseHash());

  useEffect(() => {
    const onChange = () => setParsed(parseHash());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  const navigate = useCallback((route: PortalRoute, param?: string) => {
    const target = `#/portal/${route}${param ? `/${param}` : ''}`;
    window.location.hash = target;
  }, []);

  return { route: parsed.route, param: parsed.param, navigate };
}
