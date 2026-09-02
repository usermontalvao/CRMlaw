# O certificado do selo de integridade

Certificado **autoassinado**, gerado em 02/09/2026, usado pela Edge Function
`pades-sign` para selar criptograficamente os PDFs assinados.

| | |
|---|---|
| Titular | `CN=Jurius - Selo de Integridade (autoassinado), OU=Validador Publico, O=Jurius, L=Cuiaba, ST=Mato Grosso, C=BR` |
| Chave | RSA 3072 bits, SHA-256 |
| Validade | 02/09/2026 → 30/08/2036 |
| SHA-256 do certificado | `82:96:16:50:C2:60:54:2C:C1:48:83:D4:54:BA:6C:E1:E8:7B:45:59:69:27:44:5F:50:F6:6D:05:8E:DD:E7:80` |

## Onde a chave mora

A chave privada **não está neste repositório e nunca deve estar.** Ela existe
em dois lugares:

1. **Secrets do Supabase** — `PADES_P12_BASE64` e `PADES_P12_PASSWORD`. É de lá
   que a Edge Function lê, e é a única cópia que o sistema usa.
2. **`~/.jurius-pades/`** na máquina de quem gerou (`chmod 700`), com o `.key`,
   o `.crt`, o `.p12` e a senha.

Perder as duas cópias significa não conseguir mais assinar com esta identidade —
os PDFs já selados continuam válidos, mas os novos sairiam com outra chave, e
quem tivesse fixado a impressão digital acima veria a mudança.

## O que este certificado prova, e o que não prova

**Prova:** que o arquivo não mudou um único byte desde que passou pelo sistema,
e que quem selou foi a chave cuja impressão digital está acima. Verificável
offline, em qualquer leitor de PDF, sem depender do nosso site.

**Não prova identidade perante terceiros.** Sendo autoassinado, qualquer um pode
gerar um certificado dizendo "Jurius". O leitor de PDF mostrará *"validade da
assinatura desconhecida"* até que a pessoa adicione este certificado como
confiável. O que fecha essa lacuna é publicar a impressão digital acima num
lugar que a outra parte confie — e, definitivamente, trocar o `.p12` do secret
por um **e-CNPJ A1 da ICP-Brasil**, o que não exige nenhuma mudança de código.

## Trocar o certificado

```
npx --yes supabase@latest secrets set --env-file <arquivo> --project-ref uajwkqipbyxzvwjpitxl
```

com `PADES_P12_BASE64` (base64 do `.pfx`/`.p12`) e `PADES_P12_PASSWORD`. Nada
mais muda. Documentos já selados continuam válidos com o certificado antigo.
