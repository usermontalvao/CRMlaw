export {};

/*
MUDANÇA PARA APLICAR NO SignatureModule.tsx
Substituir apenas o return principal (linha ~3334)

ANTES:
return (
  <div className="space-y-4 max-w-full overflow-x-hidden" data-signature-module>
    ...
  </div>
);

DEPOIS (layout fixo):
return (
  <div className="flex flex-col h-screen overflow-hidden" data-signature-module>
    ...
  </div>
);
*/
