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
        self.root.setContentsMargins(16, 8, 16, 14)
        self.root.setSpacing(7)

        header = QHBoxLayout()
        header.setContentsMargins(2, 0, 2, 1)

        title = QLabel("HERNANDES  •  TECLADO VIRTUAL")
        title.setObjectName("keyboardTitle")

        close_button = QPushButton("×")
        close_button.setObjectName("closeKey")
        close_button.setAccessibleName("Fechar teclado")
        close_button.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        close_button.setFixedSize(42, 34)
        close_button.clicked.connect(self.request_hide.emit)

        header.addWidget(title)
        header.addStretch(1)
        header.addWidget(close_button)
        self.root.addLayout(header)

        self.keys_host = QWidget()
        self.keys_host.setObjectName("keysHost")
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
        button.setAccessibleName(label)
        button.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        button.setMinimumHeight(50)
        button.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding,
        )

        payload = label.lower() if text is None else text
        button.clicked.connect(
            lambda checked=False, a=action, t=payload:
                self.request_key.emit(a, t)
        )
        return button

    def make_row(self, specs, stretches=None, edge_padding=0):
        row = QWidget()
        row.setObjectName("keyRow")
        layout = QHBoxLayout(row)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(7)

        if edge_padding:
            layout.addStretch(edge_padding)

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

        if edge_padding:
            layout.addStretch(edge_padding)

        return row

    def number_row(self):
        return [
            (digit, "text", digit, "numberKey")
            for digit in "1234567890"
        ]

    def build_layout(self, kind):
        self._kind = kind
        self.clear_keys()

        if kind == "numeric":
            rows = [
                [
                    ("1", "text", "1", "numberKey"),
                    ("2", "text", "2", "numberKey"),
                    ("3", "text", "3", "numberKey"),
                ],
                [
                    ("4", "text", "4", "numberKey"),
                    ("5", "text", "5", "numberKey"),
                    ("6", "text", "6", "numberKey"),
                ],
                [
                    ("7", "text", "7", "numberKey"),
                    ("8", "text", "8", "numberKey"),
                    ("9", "text", "9", "numberKey"),
                ],
                [
                    ("APAGAR", "backspace", "", "dangerKey"),
                    ("0", "text", "0", "numberKey"),
                    ("OK", "enter", "", "primaryKey"),
                ],
            ]
            for row in rows:
                self.keys_layout.addWidget(self.make_row(row))
            return

        self.keys_layout.addWidget(
            self.make_row(self.number_row())
        )

        letters = [
            [(c, "text", c.lower(), "key") for c in "QWERTYUIOP"],
            [(c, "text", c.lower(), "key") for c in "ASDFGHJKLÇ"],
            [
                (c, "text", c.lower(), "key")
                for c in "ZXCVBNM"
            ] + [
                (",", "text", ",", "symbolKey"),
                (".", "text", ".", "symbolKey"),
                ("-", "text", "-", "symbolKey"),
            ],
        ]

        for row in letters:
            self.keys_layout.addWidget(self.make_row(row))

        first_label = "@" if kind == "email" else "/"
        first_text = "@" if kind == "email" else "/"

        bottom = [
            (first_label, "text", first_text, "accentKey"),
            ("ESPAÇO", "text", " ", "spaceKey"),
            ("APAGAR", "backspace", "", "dangerKey"),
            ("OK", "enter", "", "primaryKey"),
        ]
        self.keys_layout.addWidget(
            self.make_row(bottom, [1, 5, 2, 2])
        )

    def set_kind(self, kind):
        kind = kind if kind in {"text", "email", "numeric"} else "text"
        if kind != self._kind:
            self.build_layout(kind)
