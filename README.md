# Virtual Hern

Checkout touch da Hernandes para Windows, otimizado para monitor vertical.

## Tecnologia atual

A versão principal usa:

- C# / .NET 10
- WPF
- Microsoft Edge WebView2
- teclado virtual próprio
- sessão persistente do e-commerce

A versão antiga em Python/Qt foi preservada na branch `legacy-python`.

## Por que WebView2

O protótipo em QtWebEngine precisava rodar por software no AIO para evitar tela preta, o que deixava navegação e animações menos fluidas.

A versão atual usa o motor do Microsoft Edge integrado ao Windows, mantendo aceleração gráfica nativa.

## Recursos

- e-commerce Hernandes em tela cheia;
- tela vertical / portrait;
- teclado virtual automático;
- linha numérica completa;
- layouts de texto, e-mail e numérico;
- teclado abre somente em campos digitáveis;
- login, cookies e armazenamento do site persistentes;
- perfil WebView2 salvo em `%LOCALAPPDATA%\GrupoHernandes\VirtualHern\WebView2`;
- fluxo pós-compra na página `/confirmacao`;
- após o OK do pedido concluído aparece **Voltar ao início**;
- `F5` recarrega;
- `Ctrl + Shift + F12` fecha o kiosk.

## Estrutura

```text
virtual-Hern/
├── src/
│   └── HernandesCheckout/
│       ├── HernandesCheckout.csproj
│       ├── App.xaml
│       ├── App.xaml.cs
│       ├── MainWindow.xaml
│       ├── MainWindow.xaml.cs
│       ├── VirtualKeyboard.xaml
│       ├── VirtualKeyboard.xaml.cs
│       └── Resources/
│           ├── keyboard_bridge.js
│           └── checkout_flow.js
├── build_windows.bat
└── .github/workflows/build-windows.yml
```

## Gerar o EXE

No Windows, execute:

```bat
build_windows.bat
```

Se o .NET SDK não estiver disponível, o script baixa uma cópia local automaticamente.

Ao terminar:

```text
dist\HernandesCheckout.exe
```

O publish é self-contained e gera o launcher em arquivo único.

## GitHub Actions

Cada push na branch `main` gera e valida uma versão Windows. O artefato é publicado como:

`HernandesCheckout-WebView2-Windows`

## Primeiro login

A primeira execução da versão WebView2 usa um novo perfil de navegador. Faça login uma vez. Nas próximas execuções, a sessão fica salva no perfil persistente.


## Ciclo de atendimento

No primeiro clique em **Adicionar** de cada atendimento:

1. O checkout pergunta se o cliente já possui cadastro.
2. **Sim**: a compra continua normalmente.
3. **Não**: solicita nome e telefone antes de liberar a primeira inclusão.
4. Depois da identificação, a pergunta não aparece novamente enquanto o atendimento estiver ativo.

O ciclo é reiniciado quando:

- o pedido é concluído;
- passam 2 minutos sem interação;
- o operador toca em **Reiniciar e-commerce** no topo.

Leads informados no fluxo **Não** são registrados em:

`%LOCALAPPDATA%\GrupoHernandes\VirtualHern\leads.csv`


## Integração HernandesDash

O checkout envia automaticamente eventos do totem para:

`https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem/events`

Eventos enviados:

- atendimento iniciado;
- cliente com cadastro;
- novo contato (nome e telefone);
- produto adicionado;
- pedido concluído, com número/valor/itens quando disponíveis;
- reinício manual;
- reinício por inatividade.

Cada equipamento recebe um ID persistente salvo em:

`%LOCALAPPDATA%\GrupoHernandes\VirtualHern\totem-device-id.txt`

Se a API ou internet ficar indisponível, os eventos ficam na fila:

`%LOCALAPPDATA%\GrupoHernandes\VirtualHern\totem-events-pending.jsonl`

e são reenviados automaticamente quando a conexão voltar.

A URL base pode ser sobrescrita com a variável de ambiente:

`HERNANDES_TOTEM_API_BASE_URL`

O valor padrão é:

`https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem`

A variável antiga `HERNANDES_TOTEM_API_URL` continua compatível.

Se o backend estiver configurado com `ECOMMERCE_TOTEM_API_TOKEN`, configure o mesmo valor no Windows em:

`HERNANDES_TOTEM_API_TOKEN`


## Impressão automática

O aplicativo também funciona como agente de impressão do próprio totem:

1. consulta a fila de impressão do HernandesDash a cada 2 segundos;
2. recebe apenas trabalhos destinados ao ID daquele totem;
3. envia o cupom para a impressora configurada no Windows;
4. confirma no HernandesDash se foi impresso;
5. falhas transitórias são tentadas novamente;
6. se não houver impressora configurada, o trabalho permanece pendente no servidor.

Por padrão é utilizada a impressora padrão do Windows.

Para escolher uma impressora específica, configure:

`HERNANDES_TOTEM_PRINTER_NAME`

Exemplo:

`HERNANDES_TOTEM_PRINTER_NAME=EPSON TM-T20X`

A API pública usada pelo agente é:

`https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem/printer/claim`

e a confirmação da impressão é enviada para:

`/api/ecommerce/totem/printer/jobs/<job_id>/complete`

A tela final da compra é nativa do aplicativo e avisa o cliente para aguardar a impressão do cupom antes de retirá-lo.


## Configuração administrativa da impressora

No topo do checkout existe o botão **⚙** ao lado de **Reiniciar e-commerce**.

Ao abrir:

1. o aplicativo solicita acesso administrativo;
2. depois lista as impressoras instaladas no Windows;
3. permite selecionar uma impressora;
4. permite enviar um **teste de impressão**;
5. salva a impressora escolhida para os próximos cupons.

A configuração fica salva em:

`%LOCALAPPDATA%\GrupoHernandes\VirtualHern\printer-settings.json`

O acesso administrativo usa o usuário definido para o totem e a senha é validada por hash dentro do aplicativo, sem gravar a senha em texto puro no arquivo de configuração.
