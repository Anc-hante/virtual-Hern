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
4. Em **Testar Agile**, confira os recursos `pedidos`, `erp_pedidos`,
   `erp_pedidos_produtos`, seus campos, quantidade de pedidos do cliente
   ERP `12678`, a transacao, o identificador Agile e o pedido ERP.
5. Se o Agile oferecer uma lista real de produtos vinculados ao pedido, o
   agente pode emitir o cupom completo. Se os itens nao existirem ainda,
   nao imprime um comprovante incompleto.
6. Use **Pedidos anteriores** para localizar e reimprimir do historico local
   diretamente no Windows (sem fila Django).

## Identificadores (nao misturar)

- Pedido Agile: `id_pedido` ou `id` no recurso `pedidos`.
- Numero ERP: `pedido_erp` ou `id_pedido_erp`, quando preenchidos.
- Transacao: `transacao` ou `id_transacao_venda`.
- Cliente totem: codigo ERP **12678**, por `codcli` ou
  `codigo_cliente_erp`. `id_cliente` do Agile nao e codigo ERP.
- Itens: `erp_pedidos_produtos`, vinculados por `id_pedido` ou
  `id_pedido_erp`, com `id_produto`, `quantidade`, `valor_unitario`,
  `valor_total` e `descricao_produto_snapshot`.

Se o numero ERP nao vier na API, o comprovante nao inventa NUMPED;
mostra o identificador Agile e `WINTHOR: AGUARDANDO INTEGRACAO`.

## Rate limit / impressao e migracao

- Login Agile usa `POST /api/usuario/login` e JWT apenas em memoria.
- Requisicoes Agile usam HTTPS com validacao TLS, sem excecoes.
- O client trata 429 respeitando `Retry-After` ou pausa progressiva.
- Consulta automatica a cada **45 segundos**, nao 6s.
- Na primeira consulta, pedidos existentes sao colocados como **historicos**,
  para nao imprimir uma fila inteira de vendas antigas. Novos pedidos sao
  processados apos essa primeira consulta.
- A impressao so ocorre quando ha produtos reais. Reimpressao requer login
  do administrador. O spooler nao comprova fisicamente a saida do papel.
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

**Limitacao importante:** a documentacao publica nao garante que os
itens de novos pedidos estejam no recurso `erp_pedidos_produtos` antes
da sincronizacao ERP. Se a amostra retornar produtos vazios, pedir ao suporte
Agile o recurso que disponibiliza os itens do pedido imediatamente no
checkout. Nao contornar imprimindo itens inventados.

## Pendencias de homologacao

- Confirmar em conta Agile real GET `pedidos`, `erp_pedidos`,
  `erp_pedidos_produtos` e respectivas permissoes.
- Confirmar que o campo `codcli` de `pedidos` e igual a 12678.
- Confirmar como `id_pedido` se relaciona a `id_pedido` e
  `id_pedido_erp` dos itens.
- Testar um novo pedido e a impressao fisica na ELGIN i8.
- Testar navegacao do botao Iniciar novo atendimento separadamente.

## Como baixar

Repositorio completo: https://github.com/Anc-hante/virtual-Hern/archive/refs/heads/main.zip

Executavel: GitHub Actions -> ultimo build verde -> Artifacts ->
`HernandesCheckout-Electron-Windows`.

## Para continuar em outro chat

Pedir para ler este arquivo primeiro e continuar pela branch `main`
do repo `Anc-hante/virtual-Hern`. Nao refazer a integracao
via HernandesDash. Nao publicar segredos. Solicitar apenas o
diagnostico sanitizado do Admin > Integracao Agile e a saida real da ELGIN i8.
