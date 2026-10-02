from PySide6.QtCore import Property, Qt, Signal
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)


class KeyboardPanel(QWidget):
    request_key = Signal(str, str)
    request_hide = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._panel_height = 0
        self._kind = "text"

        self.setObjectName("keyboardPanel")
        self.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Fixed,
        )
        self.setMinimumHeight(0)
        self.setMaximumHeight(0)

        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(12, 10, 12, 12)
        self.root.setSpacing(8)

        header = QHBoxLayout()
        title = QLabel("TECLADO HERNANDES")
        title.setObjectName("keyboardTitle")

        hint = QLabel("Toque fora do campo ou em OK para fechar")
        hint.setObjectName("keyboardHint")

        close_button = QPushButton("Fechar")
        close_button.setObjectName("closeKey")
        close_button.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        close_button.clicked.connect(self.request_hide.emit)

        header.addWidget(title)
        header.addStretch(1)
        header.addWidget(hint)
        header.addSpacing(8)
        header.addWidget(close_button)
        self.root.addLayout(header)

        self.keys_host = QWidget()
        self.keys_layout = QVBoxLayout(self.keys_host)
        self.keys_layout.setContentsMargins(0, 0, 0, 0)
        self.keys_layout.setSpacing(7)
        self.root.addWidget(self.keys_host, 1)

        self.build_layout("text")

    def get_panel_height(self):
        return self._panel_height

    def set_panel_height(self, value):
        value = max(0, int(value))
        self._panel_height = value
        self.setMinimumHeight(value)
        self.setMaximumHeight(value)

    panelHeight = Property(int, get_panel_height, set_panel_height)

    def clear_keys(self):
        while self.keys_layout.count():
            item = self.keys_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    def make_key(
        self,
        label,
        action="text",
        text=None,
        object_name="key",
    ):
        button = QPushButton(label)
        button.setObjectName(object_name)
        button.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        button.setMinimumHeight(58)

        payload = label.lower() if text is None else text
        button.clicked.connect(
            lambda checked=False, a=action, t=payload:
                self.request_key.emit(a, t)
        )
        return button

    def make_row(self, specs, stretches=None):
        row = QWidget()
        layout = QHBoxLayout(row)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(7)

        for index, spec in enumerate(specs):
            label, action, text, object_name = spec
            button = self.make_key(
                label,
                action,
                text,
                object_name,
            )
            stretch = stretches[index] if stretches else 1
            layout.addWidget(button, stretch)

        return row

    def build_layout(self, kind):
        self._kind = kind
        self.clear_keys()

        if kind == "numeric":
            rows = [
                [
                    ("1", "text", "1", "key"),
                    ("2", "text", "2", "key"),
                    ("3", "text", "3", "key"),
                ],
                [
                    ("4", "text", "4", "key"),
                    ("5", "text", "5", "key"),
                    ("6", "text", "6", "key"),
                ],
                [
                    ("7", "text", "7", "key"),
                    ("8", "text", "8", "key"),
                    ("9", "text", "9", "key"),
                ],
                [
                    ("APAGAR", "backspace", "", "dangerKey"),
                    ("0", "text", "0", "key"),
                    ("OK", "enter", "", "primaryKey"),
                ],
            ]
            for row in rows:
                self.keys_layout.addWidget(self.make_row(row))
            return

        rows = [
            [(c, "text", c.lower(), "key") for c in "QWERTYUIOP"],
            [(c, "text", c.lower(), "key") for c in "ASDFGHJKL"],
            [(c, "text", c.lower(), "key") for c in "ZXCVBNM"],
        ]
        rows[-1].append(("Ç", "text", "ç", "key"))

        for row in rows:
            self.keys_layout.addWidget(self.make_row(row))

        if kind == "email":
            extras = [
                ("@", "text", "@", "accentKey"),
                (".com", "text", ".com", "accentKey"),
                (".com.br", "text", ".com.br", "accentKey"),
                ("ESPAÇO", "text", " ", "spaceKey"),
                ("APAGAR", "backspace", "", "dangerKey"),
                ("OK", "enter", "", "primaryKey"),
            ]
        else:
            extras = [
                ("123", "text", "123", "accentKey"),
                ("-", "text", "-", "accentKey"),
                ("/", "text", "/", "accentKey"),
                ("ESPAÇO", "text", " ", "spaceKey"),
                ("APAGAR", "backspace", "", "dangerKey"),
                ("OK", "enter", "", "primaryKey"),
            ]

        self.keys_layout.addWidget(
            self.make_row(extras, [1, 1, 1, 3, 1, 1])
        )

    def set_kind(self, kind):
        kind = kind if kind in {"text", "email", "numeric"} else "text"
        if kind != self._kind:
            self.build_layout(kind)
