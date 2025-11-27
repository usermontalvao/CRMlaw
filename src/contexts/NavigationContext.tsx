import React, { createContext, useContext, useState, ReactNode } from 'react';

export type ModuleName = 
  | 'dashboard'
  | 'leads'
  | 'clientes'
  | 'documentos'
  | 'processos'
  | 'requerimentos'
  | 'prazos'
  | 'intimacoes'
  | 'financeiro'
  | 'agenda'
  | 'tarefas'
  | 'notificacoes'
  | 'login'
  | 'cron'
  | 'configuracoes';

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

export const NavigationProvider: React.FC<NavigationProviderProps> = ({ 
  children, 
  initialModule = 'dashboard' 
}) => {
  const [currentModule, setCurrentModule] = useState<ModuleName>(initialModule);
  const [moduleParams, setModuleParams] = useState<Record<string, string>>({});

  const navigateTo = (module: ModuleName, params?: Record<string, string>) => {
    if (params) {
      setModuleParams(prev => ({
        ...prev,
        [module]: JSON.stringify(params)
      }));
    }
    setCurrentModule(module);
  };

  const clearModuleParams = (moduleKey: string) => {
    setModuleParams(prev => {
      const updated = { ...prev };
      delete updated[moduleKey];
      return updated;
    });
  };

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
