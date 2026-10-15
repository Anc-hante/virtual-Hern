# Hernandes Checkout — Electron

Totem de autoatendimento Windows (tela sensível ao toque) usando **Electron/Chromium**,
sem hospedar o navegador dentro do WPF/WebView2.

## O que faz

- Abre `https://www.grupohernandes.com.br/` em tela cheia.
- Botões fixos **Voltar**, **Atualizar (manual)**, **Configuração ⚙** e **Reiniciar e-commerce**.
- Teclado virtual integrado ao Chromium, com texto, números, símbolos, Shift e Enter.
- Antes de adicionar o primeiro produto, solicita a identificação do cliente e, quando
  necessário, nome e telefone; registra os dados no HernandesDash e guarda CSV de segurança.
- Tela de compra concluída com agradecimento, confetes e aviso para aguardar a impressão.
- Recupera sessões e transmite eventos ao HernandesDash; falhas de envio ficam em fila local.
- Consulta a fila de cupons do HernandesDash e imprime na impressora configurada.
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
para rodar. O `GitHub Actions` também disponibiliza o mesmo EXE como artefato
`HernandesCheckout-Electron-Windows`.

```bat
dist\HernandesCheckout.exe
```

A antiga implementação WPF permanece em `src/HernandesCheckout/*.xaml*`
para referência/rollback, mas **não é mais compilada pelo build_windows.bat**.

## Regras de atendimento

A página é carregada na abertura. Navegações provocadas por cliques no e-commerce
continuam normais. O aplicativo **não faz recargas automáticas**. O botão
**Atualizar** recarrega somente quando alguém tocar nele.

**Reiniciar e-commerce** encerra o atendimento manualmente e tenta limpar o carrinho.
Após uma compra, a tela final permanece até tocar **Iniciar novo atendimento**.
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
- Windows / Electron: `HERNANDES_TOTEM_API_TOKEN`

Nao coloque esse token no GitHub nem em scripts no ecommerce. Sem o token
no backend, a consulta administrativa retornara HTTP 503; token incorreto
retornara HTTP 401. O arquivo `electron/api.js` nao contem credenciais.

A resposta de reimpressao confirma que a solicitacao entrou na fila de
impressao, nao que a bobina saiu fisicamente. Evite repetir a solicitacao
se ela estiver pendente; o aplicativo bloqueia automaticamente duplicidade.
