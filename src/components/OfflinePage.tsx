import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, Wifi, Shield } from 'lucide-react';

const OfflinePage: React.FC = () => {
  const [checking, setChecking] = useState(false);
  const [dots, setDots] = useState('');

  // Animação dos pontos
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleRetry = async () => {
    setChecking(true);
    
    // Tentar reconectar
    try {
      await fetch('https://www.google.com/favicon.ico', { 
        mode: 'no-cors',
        cache: 'no-store'
      });
      // Se chegou aqui, está online
      window.location.reload();
    } catch {
      // Ainda offline
      setTimeout(() => setChecking(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      {/* Background sutil */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-slate-300/30 rounded-full blur-3xl" />
      </div>

      {/* Conteúdo principal */}
      <div className="relative z-10 text-center max-w-md mx-auto">
        {/* Logo e ícone */}
        <div className="mb-8">
          {/* Logo do projeto */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl blur opacity-30" />
              <div className="relative h-20 w-20 rounded-xl shadow-lg bg-amber-500 flex items-center justify-center">
                <span className="text-white font-bold text-4xl">J</span>
              </div>
              {/* Badge offline */}
              <div className="absolute -bottom-2 -right-2 bg-red-500 rounded-full p-1.5 shadow-lg">
                <WifiOff className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
          
          {/* Nome do app */}
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            jurius<span className="text-amber-500">.com.br</span>
          </h1>
          <p className="text-xs text-slate-400 flex items-center justify-center gap-1">
            <Shield className="w-3 h-3" />
            Plataforma Segura
          </p>
        </div>

        {/* Card principal */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 mb-6">
          {/* Ícone de sem conexão */}
          <div className="relative inline-block mb-6">
            <div className="bg-red-50 p-6 rounded-full">
              <WifiOff className="w-12 h-12 text-red-500" />
            </div>
            {/* Ondas animadas */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute w-24 h-24 border-2 border-red-200 rounded-full animate-ping opacity-30" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-2">
            Sem Conexão
          </h2>
          
          <p className="text-slate-500 mb-6">
            Não foi possível conectar à internet{dots}
          </p>

          {/* Botão de retry */}
          <button
            onClick={handleRetry}
            disabled={checking}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-6 py-3 rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <RefreshCw className={`w-5 h-5 ${checking ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
            {checking ? 'Verificando...' : 'Tentar Novamente'}
          </button>
        </div>

        {/* Dicas */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-5 border border-slate-200 text-left">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-amber-500" />
            O que você pode fazer:
          </h3>
          <ul className="space-y-2 text-sm text-slate-500">
            <li className="flex items-start gap-2">
              <span className="text-amber-500 font-bold">1.</span>
              Verifique se o Wi-Fi está ativado
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 font-bold">2.</span>
              Reinicie seu roteador
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 font-bold">3.</span>
              Tente usar dados móveis
            </li>
          </ul>
        </div>

        {/* Footer */}
        <p className="mt-6 text-xs text-slate-400">
          © {new Date().getFullYear()} jurius.com.br
        </p>
      </div>
    </div>
  );
};

export default OfflinePage;
