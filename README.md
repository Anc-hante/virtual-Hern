> **NOVO FLUXO (Agile direto):** A versão atual do Electron consulta pedidos
> diretamente na API Agile, sem usar a fila do HernandesDash e sem
> `ECOMMERCE_TOTEM_API_TOKEN`. Configure **Client ID** e **Client Secret**
> apenas na área administrativa **Integração Agile**. Veja
> [AGILE-DIRETO-TESTE.md](./AGILE-DIRETO-TESTE.md). Os tópicos de
> autenticação HernandesDash abaixo se referem ao fluxo legado e não
> são necessários para os novos cupons Agile.
>
> **Privacidade:** não salvar segredos no GitHub. Nenhum `.env` contendo
> credenciais foi enviado ao repositório. A configuração é feita uma vez
> no Windows, criptografada com DPAPI.

# Hernandes Checkout — Electron

Totem de autoatendimento Windows (tela sensível ao toque) usando **Electron/Chromium**,
sem hospedar o navegador dentro do WPF/WebView2.

## O que faz

- Abre `https://www.grupohernandes.com.br/` em tela cheia.
- Botões fixos **Voltar**, **Atualizar (manual)**, **Configuração ⚙** e **Reiniciar e-commerce**.
- Teclado virtual integrado ao Chromium, com texto, números, símbolos, Shift e Enter.
- Antes de adicionar o primeiro produto, solicita identificação do cliente e,
  quando necessário, nome e telefone. Mantém um CSV local de contingência.
- Tela de compra concluída com agradecimento, confetes e aviso para aguardar a impressão.
- Consulta a **API Agile diretamente a cada 3 segundos** (um único ciclo, com espera em HTTP 429),
  resolve o cliente 12678 para o `id_cliente` Agile e imprime o comprovante não fiscal na ELGIN i8
  quando o pedido fica confirmado, mesmo antes do WinThor.
- Aceita o identificador/transação Agile quando o NUMPED WinThor ainda não existe.
  Se os itens ainda não vierem, imprime só o total. Carrinho, rascunho e cancelado não são impressos;
  a primeira leitura não imprime automaticamente pedidos históricos.
- Mantém histórico local para impedir impressões duplicadas e permitir reimpressão no admin.
- Permite impressão de teste e seleção de impressora após autenticação administrativa.
- **Não faz reset por inatividade** e **não atualiza a página por timer**.

## Compilação no Windows

Instale o [Node.js LTS](https://nodejs.org/) e, dentro da pasta do repositório, rode:

```bat
git pull origin main
build_windows.bat
```

Alternativamente:

```bat
npm install
npm run check
npm run build
```

O executável portátil fica em `dist\HernandesCheckout.exe`. Ele inclui o
Chromium do Electron e **não depende de Node.js nem do .NET instalado no computador**
para rodar. Cada push na `main` publica o mesmo arquivo em
https://github.com/Anc-hante/virtual-Hern/releases/download/totem-latest/HernandesCheckout.exe
e o grava em `dist/HernandesCheckout.exe`. O Actions também gera o artefato
`HernandesCheckout-Electron-Windows`.

```bat
dist\HernandesCheckout.exe
```

A antiga implementação WPF permanece em `src/HernandesCheckout/*.xaml*`
para referência/rollback, mas **não é mais compilada pelo build_windows.bat**.

## Iniciar com o Windows

Com `dist\HernandesCheckout.exe` já gerado, execute na pasta do repositório:

```bat
instalar_inicio_automatico.bat
```

O script cria o atalho `HernandesCheckout.lnk` na pasta Inicializar do usuário
atual (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`). O atalho
aponta para o executável ao lado do script, usa `dist` como pasta de trabalho
e abre a janela maximizada. O totem passa a iniciar sozinho no logon desse
usuário, ao ligar ou reiniciar o Windows.

Para desfazer:

```bat
instalar_inicio_automatico.bat remover
```

## Regras de atendimento

A página é carregada na abertura. Navegações provocadas por cliques no e-commerce
continuam normais. O aplicativo **não faz recargas automáticas**. O botão
**Atualizar** recarrega somente quando alguém tocar nele.

**Reiniciar e-commerce** encerra o atendimento manualmente e tenta limpar o carrinho.
Após a impressão enviada ao spooler Windows, o totem retorna à página inicial
para novo atendimento. Se a impressão ainda não foi enviada, mantém a tela final
com diagnóstico e opção de verificar novamente.
O carrinho permanece sujeito à disponibilidade/funcionamento do próprio site e
não há garantia de limpeza se o e-commerce não disponibilizar a operação.

**Não existe reset de 2 minutos.**

## Impressão

No topo, toque em **⚙**. Um administrador informa as credenciais configuradas no
totem e abre a lista de impressoras instaladas no Windows. Depois pode
**Testar impressão** e **Salvar impressora**.

A escolha anterior do aplicativo WPF é reutilizada:

```text
%LOCALAPPDATA%\GrupoHernandes\VirtualHern\printer-settings.json
```

Também é reutilizado o ID já existente em
`%LOCALAPPDATA%\GrupoHernandes\VirtualHern\totem-device-id.txt`, para
evitar criar um totem duplicado no HernandesDash.

O agente consulta a API aproximadamente a cada 6 segundos, sem recarregar o
site. Se não houver uma impressora salva/instalada, não retira itens da fila.

**Observação:** sucesso na API nativa de impressão significa que o Windows
**aceitou o trabalho na fila**; não existe confirmação do sensor físico de que
o papel terminou de sair. A tela do cliente orienta aguardar o cupom.

## API

Base padrão:

```text
https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem
```

Opcionalmente, configure:

```bat
setx HERNANDES_TOTEM_API_BASE_URL "https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem"
setx HERNANDES_TOTEM_API_TOKEN "TOKEN_CONFIGURADO_NO_BACKEND"
```

O servidor deve configurar `ECOMMERCE_TOTEM_API_TOKEN` com o mesmo token.
O token **não deve** ser armazenado no código-fonte.

O backend, e não o popup do navegador, deve reconhecer pedidos WinThor com
`PCPEDC.CODCLI = 12678`. A conciliação e a fila de impressão continuam no
HernandesDash; Electron atua como cliente HTTP e agente local de impressão.

## Segurança e perfil

A UI do site usa `contextIsolation`, `sandbox` e `nodeIntegration:false`.
A página só tem uma ponte de **envio de eventos** (sem acesso às credenciais de
administração, ao filesystem, ou à seleção da impressora). Todas as ações
administrativas são processadas no host, não no site.

A senha administrativa foi armazenada como SHA-256 no código; por ser um programa
local, isso impede exposição em texto puro, **mas não substitui autenticação
centralizada ou controles de acesso do Windows**.

O Electron usa perfil de navegação separado do Edge WebView2. É possível que
o operador precise fazer login no e-commerce novamente após a migração.

## Diagnóstico

O projeto preserva arquivos de contingência locais em
`%LOCALAPPDATA%\GrupoHernandes\VirtualHern`.

Falhas do e-commerce ou da impressora devem ser investigadas por logs e por
testes reais no equipamento antes de considerar o fluxo de impressão concluído.

## Cupom grande e QR Code (ELGIN i8)

O comprovante usa bobina de **80 mm**, impressão pelo driver instalado do Windows
e um QR Code gerado localmente (sem depender da internet para criar a imagem).
Ele aponta sempre para:

`https://www.grupohernandes.com.br/cadastrar`

O número impresso é o **NUMPED real do WinThor**. O backend só libera o cupom
após reconciliar o pedido do cliente exclusivo do totem, código **12678**.
Pedidos com número provisório não são impressos.

Na engrenagem ⚙, faça login como administrador, selecione a impressora e toque
em **Visualizar modelo completo do cupom**. O botão **Testar impressão** também
abre a prévia e imprime uma demonstração com itens, valores fictícios e o QR
real. Essa demonstração aparece identificada para não ser confundida com venda.

Se o teste envia ao Windows mas não sai papel, examine a fila de impressão,
driver ELGIN i8 e configuração de bobina 80 mm no Windows. O status de
"enviado" indica aceitação pelo spooler; o aplicativo não possui sensor para
confirmar a saída física do papel.

O teclado Electron é acionado pelo `pointerdown` no próprio Chromium, sem
redimensionar o navegador. O formulário de nome/telefone é deslocado acima
dele quando necessário.

## Reimpressao de pedidos anteriores no painel do totem

Na engrenagem (area administrativa), entre com o usuario admin e abra
**Pedidos anteriores**. Pesquise pelo numero do pedido WinThor, veja data,
valor e status e toque em **Reimprimir**. Sera pedida confirmacao antes de
colocar o cupom na fila da ELGIN i8. O cupom contem o QR Code de cadastro
como na impressao original.

As consultas sao paginadas em lotes de 25 pedidos, e mostram somente
registros do proprio dispositivo existentes no banco do HernandesDash.
Nao mostra automaticamente todo o historico do WinThor. Pedidos que ainda
nao tiverem NUMPED confirmado nao podem ser reimpressos.

**Requisito para ativar:** configure o mesmo token no ambiente privado
dos dois lados, caso ainda nao esteja configurado:

- Backend: `ECOMMERCE_TOTEM_API_TOKEN`
- Windows / Electron: configure uma vez em **Admin → Conexão com API**. O
  token fica criptografado com Windows DPAPI em
  `%LOCALAPPDATA%\\GrupoHernandes\\VirtualHern\\api-token.dpapi`.
  A variavel `HERNANDES_TOTEM_API_TOKEN` continua disponivel como alternativa
  para administradores, mas nao e mais necessaria no computador.

Nao coloque esse token no GitHub nem em scripts no ecommerce. Sem o token
no backend, a consulta administrativa retornara HTTP 503; token incorreto
retornara HTTP 401. O arquivo `electron/api.js` nao contem credenciais.

A resposta de reimpressao confirma que a solicitacao entrou na fila de
impressao, nao que a bobina saiu fisicamente. Evite repetir a solicitacao
se ela estiver pendente; o aplicativo bloqueia automaticamente duplicidade.

### Ativar a conexao com API sem editar o codigo do Electron

1. No servidor, configure `ECOMMERCE_TOTEM_API_TOKEN` no `backend/repo/.env`.
   Use um token aleatorio exclusivo (nunca as credenciais do Agile).
2. Abra o novo EXE. Toque em `⚙`, faca login como admin e abra
   **Conexao com API**.
3. Informe o **mesmo token configurado no servidor**. Toque em
   **Salvar token com protecao do Windows**, depois em **Testar conexao**.
4. Quando a conexao estiver validada, use a aba **Pedidos anteriores**.
   O token nao aparece no frontend e nao e incorporado ao EXE nem ao GitHub.

Esta configuracao se refere a **autenticacao entre Electron e HernandesDash**.
A integracao Agile (client_id/client_secret) pertence apenas ao backend e
continua separada, com credenciais privadas. Nao coloque as chaves do
Agile no app Electron.

### Servidor corporativo com certificado HTTPS autoassinado (homologacao)

Por padrao, o aplicativo valida o certificado da API. Se o Nginx interno
`hernandesvpn.dyndns.org:3000` usa certificado autoassinado durante o
teste na rede da empresa, abra **Admin > Conexao com API** e marque
**Permitir o certificado atual do servidor Hernandes sem validacao de
autoridade certificadora**; clique em **Aplicar modo HTTPS interno** e
depois **Testar conexao**.

Na versao de homologacao, a excecao e **ligada por padrao** e **somente** vale para
`https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem/`.
Nao altera a validacao TLS do ecommerce, Agile, outros hosts ou Chromium.
Nao usa `NODE_TLS_REJECT_UNAUTHORIZED=0`. Os tokens continuam
criptografados no Windows (DPAPI) mas podem ser interceptados se alguem
se passar pelo servidor enquanto a excecao estiver ativa. Mesmo numa rede
corporativa, isso NAO equivale a uma conexao com identidade verificada.

**Desative depois dos testes.** Para producao permanente, instale um
certificado confiavel ou a CA interna da empresa no cliente/servidor.
A excecao nao contorna a autenticacao da API: se o token estiver incorreto,
havera HTTP 401; se nao estiver configurado no backend, HTTP 503.

### Agile no painel administrativo (Client ID e Client Secret)

Abra **⚙ > Administração > Integração Agile**. Informe `Client ID`
e `Client Secret` obtidos no painel de aplicativos Agile e clique
**Salvar credenciais do Agile**. Os valores ficam cifrados no Windows,
na pasta privada do aplicativo, usando DPAPI. Nenhuma chave do Agile e
gravada no repositorio nem integrada ao navegador publico de compras.
O campo de token do HernandesDash e **outro acesso**, com finalidade
diferente.

**Testar Agile** autentica em `POST /api/usuario/login` e consulta
`GET /api/integracao/pedidos?page=1&limit=10` (somente leitura).
A resposta mostra apenas identificadores encontrados do cliente `12678`,
quando o recurso expuser esse codigo, e a lista de nomes dos campos
do primeiro registro. Outros compradores nao sao exibidos.

**ATENCAO:** conseguir consultar o Agile NAO significa que a impressao
pelo Agile ja esteja ativada. Precisamos homologar os identificadores,
o status de venda e a relacao entre numero Agile e NUMPED WinThor
antes de alimentar a fila de cupons, que permanece com validacao ERP.

### HTTP 429 e HTTPS interno

O app aplica cooldown e respeita `Retry-After` quando a API do
HernandesDash retorna 429, evitando consultas repetidas a cada 6 s.
O proxy nginx do HernandesDash na branch `docker` recebeu uma zona
dedicada para rotas `/api/ecommerce/totem/`; esta alteracao requer
**atualizar/recriar o container proxy no servidor**.

A pedido da homologacao na rede corporativa, o modo de certificado
interno e **ativado inicialmente por padrao**, exclusivamente para
`hernandesvpn.dyndns.org:3000` e rotas `/api/ecommerce/totem/`.
Ele nao afeta a API Agile, o navegador ecommerce ou outros hosts.
A verificacao da identidade do servidor fica enfraquecida nesse modo,
mesmo numa rede local; para producao, prefira certificado de CA
confiavel ou cadeia interna instalada no Windows.
O administrador pode desligar o modo em **Conexao com API**.
