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
