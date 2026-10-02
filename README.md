# Virtual Hern

Aplicativo de checkout em **Python + PySide6 + QtWebEngine** para abrir o e-commerce Hernandes em modo kiosk no Windows, com teclado virtual touch pensado para monitor vertical.

## Principais recursos

- Abre https://www.grupohernandes.com.br/ em Chromium embutido.
- Modo tela cheia para checkout.
- Mantém cookies, local storage e sessão entre reinícios.
- Detecta automaticamente campos digitáveis.
- Teclado sobe e desce com animação, redimensionando o site sem cobrir o conteúdo.
- Layouts de teclado para texto, e-mail e números.
- Pensado para tela vertical / portrait.
- Atalho administrativo: `Ctrl + Shift + F12`.
- `F5` recarrega o e-commerce.

## Testar no Windows

1. Instale Python 3.11 ou 3.12 64 bits.
2. Marque **Add python.exe to PATH** durante a instalação.
3. Execute `run_windows_test.bat`.

## Executar em tela cheia

Execute:

```bat
run_windows.bat
```

## Gerar o EXE

Execute:

```bat
build_windows.bat
```

O executável será criado em:

```
dist\HernandesCheckout\HernandesCheckout.exe
```

Mantenha toda a pasta `HernandesCheckout`, pois o QtWebEngine utiliza arquivos auxiliares junto do executável.

## Iniciar com o Windows

Depois de gerar o EXE, execute:

```bat
CRIAR_ATALHO_INICIALIZACAO.bat
```

Para remover a inicialização automática:

```bat
REMOVER_INICIALIZACAO.bat
```

## Configuração

Edite `config.json` para alterar URL, altura do teclado e velocidade da animação.

## Build automático

O repositório contém um workflow do GitHub Actions que compila a versão Windows e publica o resultado como artefato do workflow.
