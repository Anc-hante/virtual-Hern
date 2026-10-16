# Totem Hernandes - Integracao Agile direta

## Repositorios e branches

- Totem Electron Windows: https://github.com/Anc-hante/virtual-Hern (branch `main`)
- Dashboard Django (historico, nao necessario para as novas consultas Agile):
  https://github.com/Anc-hante/HernandesDash (branch `docker`)
- API Agile: https://api-integracao.agileecommerce.com.br/
- Swagger: https://api-integracao.agileecommerce.com.br/swagger/ui/index

## Fluxo atual (sem segunda API)

Agile HTTPS -> aplicativo Electron do totem -> ELGIN i8 Windows 80mm.
**Nao usa HernandesDash para consultar, imprimir nem reimprimir pedidos Agile.**

1. No Windows do totem, instale o `HernandesCheckout.exe` mais recente.
2. Abra a engrenagem, entre na area admin e selecione a impressora ELGIN i8.
3. Em **Integracao Agile**, cadastre Client ID e Client Secret da conta Agile.
   Os valores ficam protegidos pelo Windows DPAPI em
   `%LOCALAPPDATA%\GrupoHernandes\VirtualHern\agile-credentials.dpapi`.
4. Em **Testar Agile**, confira `clientes?codigo=12678`, `pedidos` por
   `id_cliente`, `pedidos_produtos` e, se a conta publicar, `erp_pedidos`.
   O codigo ERP `12678` nao vem na linha de `pedidos`.
5. Com produtos reais, o cupom lista os itens e o total. Se a consulta de
   itens falhar, o cupom sai so com o total informado pelo Agile. Nunca
   completa com produto, preco ou quantidade inventados.
6. Use **Pedidos anteriores** para localizar e reimprimir do historico local
   diretamente no Windows (sem fila Django).

## Identificadores (nao misturar)

- Pedido Agile: `id` no recurso `pedidos` (antes do WinThor).
- Numero ERP: `codigo` em `pedidos`, ou `pedido_erp` / `id_pedido_erp`
  em `erp_pedidos`, somente quando a API preencher. Vazio significa
  `WINTHOR: AGUARDANDO INTEGRACAO`.
- Transacao: `id_transacao` (ou `transacao` / `id_transacao_venda`).
- Cliente totem: codigo ERP **12678**. Ele nao esta na linha de `pedidos`.
  Resolver com `GET /api/integracao/clientes?codigo=12678` e usar
  `data[].id` (o `id_cliente` Agile) em
  `GET /api/integracao/pedidos?id_cliente=<id>&sort=data&order=DESC&limit=5`.
- Itens antes do WinThor: `GET /api/integracao/pedidos_produtos?id_pedido=<id>`
  com `id_produto`, `quantidade`, `valor_total`, `valor_unitario` /
  `valor_embalagem`. O nome sai do campo `json` (`nome`); se faltar,
  `GET /api/integracao/produtos/<id_produto>`. `preco_base` nao substitui
  o valor cobrado.
- Pagamento: `GET /api/integracao/pedidos_pagamentos?id_pedido=<id>`.
  Nao bloqueia a impressao.
- `erp_pedidos` e `erp_pedidos_produtos` continuam opcionais, so para
  enriquecer o NUMPED quando ele aparecer.

Se o numero ERP nao vier na API, o comprovante nao inventa NUMPED;
mostra o identificador Agile e `WINTHOR: AGUARDANDO INTEGRACAO`.

## Rate limit / impressao e migracao

- Login Agile usa `POST /api/usuario/login` com `{client_id, client_secret}`.
  O JWT fica so em memoria. `Expiration` vem como data ISO (um numero em
  segundos ainda e aceito). O token e reutilizado ate pouco antes de expirar.
- O mapa `12678 -> id_cliente` tambem fica em memoria.
- Requisicoes Agile usam HTTPS com validacao TLS, sem excecoes.
- O client trata 429 respeitando `Retry-After`, com teto de cerca de **60s**.
- **Monitor leve (sempre ligado com o app aberto):** um unico ciclo
  `setTimeout` no processo principal, nunca `setInterval` e nunca dois
  polls ao mesmo tempo. A consulta barata roda a cada **3 segundos** e e
  so `pedidos?id_cliente=<id>&sort=data&order=DESC&limit=5`. Itens e
  pagamentos so entram para um pedido novo confirmado. A impressao pausa
  o poll. Se o ciclo quebrar, ele reagenda sozinho. Erros usam espera
  exponencial (maximo ~60s) e depois voltam aos 3s. Nao ha log a cada
  poll sem novidade; o log do monitor e limitado e rotacionado. Os ids
  ja vistos ficam numa memoria de no maximo 500, e o historico em disco
  tambem e cortado em 500.
- Na primeira consulta, pedidos existentes sao colocados como **historicos**,
  para nao imprimir uma fila inteira de vendas antigas. Um carrinho visto
  depois disso fica em observacao. Quando o mesmo pedido fica
  `confirmado=true` e o status deixa de ser `carrinho` (ex.: `recebido`),
  sem cancelamento, ele e impresso uma unica vez. Uma venda correlacionada
  a checkout pendente tem prioridade e, apos o spooler aceitar o cupom,
  o totem volta a pagina inicial.
- NUMPED WinThor nao e obrigatorio. Sem itens, imprime somente o total
  real. Reimpressao requer login do administrador. O spooler nao comprova
  fisicamente a saida do papel.
- Ledger local de impressao:
  `%LOCALAPPDATA%\GrupoHernandes\VirtualHern\agile-print-history.json`.

## Testes, credenciais e limites

**Nao colocar no GitHub** Client ID, Client Secret, JWT ou token do backend,
mesmo que o repositorio se torne privado depois. Nao adicionar arquivo .env
com credenciais ao repositorio.

As consultas em API de producao requerem rede funcional no computador que
executa o aplicativo. O ambiente de CI usa testes simulados e nao tem
permissao para validar a conta Agile de producao.

O login, o GET dos tres recursos e a amostra de itens devem ser conferidos
no **Testar Agile** e as evidencias sanitizadas (sem credenciais ou PII)
devem ser compartilhadas antes de declarar a integracao operacional.

**Itens antes do WinThor:** a conta real respondeu em
`pedidos_produtos?id_pedido=<id>` (o caminho `pedidos_produtos/{id}` veio
vazio). Se essa lista falhar, o cupom leva so o total. Nao inventar itens.

## Pendencias de homologacao

- Amostra real (pedido `1000018742`, cliente ERP 12678, `id_cliente`
  `01450747221`): `carrinho`/`confirmado=false`, depois `recebido`/
  `confirmado=true`, `integrado=false`, `codigo` nulo. Itens em
  `pedidos_produtos?id_pedido=`. Cancelados vem com status `cancelado`.
- `erp_pedidos` segue opcional. Nao depende de `codcli` na linha de `pedidos`.
- Cupom sem NUMPED: TRANSACAO AGILE e WINTHOR AGUARDANDO INTEGRACAO.
  A saida fisica na ELGIN i8 ainda precisa ser vista no totem; o spooler
  nao prova o papel.
- Testar navegacao do botao Iniciar novo atendimento separadamente.

## Como baixar

Repositorio completo: https://github.com/Anc-hante/virtual-Hern/archive/refs/heads/main.zip

Executavel (link estavel, atualizado a cada push na `main`):
https://github.com/Anc-hante/virtual-Hern/releases/download/totem-latest/HernandesCheckout.exe

O mesmo arquivo fica em `dist/HernandesCheckout.exe` na branch `main`.
O artefato do Actions `HernandesCheckout-Electron-Windows` continua sendo gerado.

## Para continuar em outro chat

Pedir para ler este arquivo primeiro e continuar pela branch `main`
do repo `Anc-hante/virtual-Hern`. Nao refazer a integracao
via HernandesDash. Nao publicar segredos. Solicitar apenas o
diagnostico sanitizado do Admin > Integracao Agile e a saida real da ELGIN i8.

## Testar com .env privada (Node 22 ou superior)

A raiz do repositorio contem `.env.example` sem nenhuma credencial real.
No computador Windows, copie para `.env`, preencha **AGILE_CLIENT_ID** e
**AGILE_CLIENT_SECRET** e execute:

```powershell
node --env-file=.env scripts/testar-agile.cjs
```

O teste faz login, consulta o cliente 12678, busca a transacao/NUMPED e
tenta recuperar itens. Exibe somente metadados resumidos. Nao imprime e nao
grava credenciais. O `.env` esta ignorado no Git.

No fluxo autonomo, **ECOMMERCE_TOTEM_API_TOKEN nao e necessario**. Essa
credencial so interessa aos endpoints antigos do Django.

**Teste real nao realizado neste ambiente:** a resolucao DNS para a
API Agile nao estava disponivel. O GitHub Actions valida logica, estrutura
e build com dados de teste, sem enviar segredos para os logs.
