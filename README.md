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
