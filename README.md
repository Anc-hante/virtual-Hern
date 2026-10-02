# Virtual Hern

Checkout touch da Hernandes para Windows, desenvolvido em Python com PySide6 + QtWebEngine e pensado para monitor vertical.

## Entrega final

O projeto gera **um único arquivo executável**:

```text
dist\HernandesCheckout.exe
```

O cliente não precisa levar `config.json`, JavaScript, DLLs ou outras pastas ao lado do programa. Os recursos necessários são empacotados dentro do EXE.

## Funcionamento

- Abre https://www.grupohernandes.com.br/ em Chromium embutido.
- Opera em tela cheia no modo checkout.
- Mantém cookies, local storage e sessão entre reinícios.
- Detecta automaticamente quando um campo precisa de digitação.
- O teclado sobe e desce suavemente.
- O e-commerce redimensiona em vez de ficar escondido atrás do teclado.
- Teclado específico para texto, e-mail e números.
- Interface otimizada para tela vertical.
- `F5` recarrega o e-commerce.
- `Ctrl + Shift + F12` encerra o modo kiosk.

## Estrutura

```text
virtual-Hern/
├── src/
│   ├── main.py
│   ├── browser.py
│   ├── keyboard.py
│   ├── app_config.py
│   └── resources/
│       └── keyboard_bridge.js
├── build_windows.bat
├── requirements.txt
├── .gitignore
└── README.md
```

Os arquivos em `src/` existem apenas para desenvolvimento. Depois do build, a distribuição é somente `HernandesCheckout.exe`.

## Gerar no Windows

Recomendado: Python 3.14 64 bits.

Abra a pasta do projeto e execute:

```bat
build_windows.bat
```

O script cria o ambiente virtual, instala as dependências e usa PyInstaller em modo `--onefile`.

Ao terminar, use somente:

```text
dist\HernandesCheckout.exe
```

## Teste sem gerar EXE

Para desenvolvimento:

```bat
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
py src\main.py --windowed
```

## Sessão do e-commerce

Cookies e dados da sessão não ficam ao lado do EXE. O QtWebEngine grava o perfil persistente na pasta de dados do aplicativo do usuário do Windows, permitindo manter o login entre execuções.
