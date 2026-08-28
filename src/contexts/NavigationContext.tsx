import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import {
  MODULE_PATHS,
  type ModuleName,
  isCleanCrmLocation,
  moduleToPath,
  pathToModule,
  takePendingModule,
} from '../utils/moduleRoutes';

export type { ModuleName };
export { MODULE_PATHS };

interface ModuleParams {
  [key: string]: any;
}

interface NavigationContextType {
  currentModule: ModuleName;
  moduleParams: Record<string, string>;
  navigateTo: (module: ModuleName, params?: Record<string, string>) => void;
  setModuleParams: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  clearModuleParams: (moduleKey: string) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

interface NavigationProviderProps {
  children: ReactNode;
  initialModule?: ModuleName;
}

/**
 * Escreve o módulo atual na barra de endereços.
 *
 * Preserva query e hash: o App ainda lê coisas do hash (`#editor-doc=`, por
 * exemplo) e trocar de módulo não pode apagá-las.
 */
function writeUrl(module: ModuleName, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  const path = moduleToPath(module);
  if (!path) return; // módulo sem URL própria (login) — mantém o caminho atual
  const target = `${path}${window.location.search}${window.location.hash}`;
  if (window.location.pathname === path) {
    // Mesmo caminho: nada a empilhar (evita entradas repetidas no histórico ao
    // reclicar o item já ativo do menu).
    return;
  }
  if (mode === 'replace') window.history.replaceState({ module }, '', target);
  else window.history.pushState({ module }, '', target);
}

/**
 * Módulo do primeiro render, nesta ordem:
 *   1. caminho da URL      → `/prazos` aberto direto ou F5 em cima do módulo;
 *   2. destino pretendido  → o usuário pediu `/prazos` deslogado e acabou de
 *      passar pelo login (o boot guardou o destino antes de mandar ao portal);
 *   3. `initialModule`     → boot normal em "/".
 */
function resolveInitialModule(fallback: ModuleName): ModuleName {
  if (typeof window === 'undefined') return fallback;
  const fromPath = pathToModule(window.location.pathname);
  if (fromPath) return fromPath;
  // Rota pública/especial (assinatura, documento, cron) também monta o App:
  // ali o destino pretendido não é nosso para consumir.
  if (!isCleanCrmLocation()) return fallback;
  return takePendingModule() ?? fallback;
}

export const NavigationProvider: React.FC<NavigationProviderProps> = ({
  children,
  initialModule = 'dashboard'
}) => {
  const [currentModule, setCurrentModule] = useState<ModuleName>(() => resolveInitialModule(initialModule));
  const [moduleParams, setModuleParams] = useState<Record<string, string>>({});

  // "/" continua valendo como o módulo inicial: não reescrevemos a URL no boot
  // normal (é a start_url do PWA). Só alinhamos quando o módulo veio do destino
  // pretendido — aí a URL precisa passar a refletir a tela, senão o primeiro F5
  // seguinte voltaria ao dashboard.
  const fallbackModuleRef = useRef<ModuleName>(initialModule);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pathToModule(window.location.pathname)) return; // já veio da URL
    if (currentModule === initialModule) return;        // boot normal em "/"
    writeUrl(currentModule, 'replace');
    // Só no boot: daqui para frente quem escreve a URL é o navigateTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voltar/avançar do navegador: a URL já mudou sozinha, só acompanhamos o
  // estado. Nada de escrever no histórico aqui — seria empilhar de novo o que o
  // usuário acabou de desempilhar.
  useEffect(() => {
    const handlePopState = () => {
      const module = pathToModule(window.location.pathname);
      setCurrentModule(module ?? fallbackModuleRef.current);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = useCallback((module: ModuleName, params?: Record<string, string>) => {
    if (params) {
      setModuleParams(prev => ({
        ...prev,
        [module]: JSON.stringify(params)
      }));
    }
    setCurrentModule(module);
    writeUrl(module, 'push');
  }, []);

  const clearModuleParams = useCallback((moduleKey: string) => {
    setModuleParams(prev => {
      const updated = { ...prev };
      delete updated[moduleKey];
      return updated;
    });
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        currentModule,
        moduleParams,
        navigateTo,
        setModuleParams,
        clearModuleParams
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
};

/**
 * A mesma navegação, mas SEM exigir o provider.
 *
 * Existe por causa das telas que o CRM e o app de atendimento compartilham: a
 * ficha 360 do cliente abre tanto dentro do CRM (onde há NavigationProvider e
 * "abrir no módulo" faz sentido) quanto de dentro da conversa no app avulso
 * `/atendimento`, que não tem módulos para onde ir. Lá `useNavigation` lançava e
 * derrubava a ficha inteira; aqui devolve `null` e quem chama decide o plano B.
 */
export const useNavigationOptional = () => useContext(NavigationContext) ?? null;
