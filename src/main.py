import os
import sys

# Configure Qt/Chromium before importing any PySide6 module.
# This avoids black WebEngine surfaces on Windows machines/drivers that
# have trouble with Chromium GPU compositing.
os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "1")
os.environ.setdefault("QT_OPENGL", "software")
os.environ.setdefault("QT_QUICK_BACKEND", "software")
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS",
    "--disable-gpu --disable-gpu-compositing --disable-features=Vulkan",
)

from PySide6.QtCore import QEasingCurve, QPropertyAnimation, Qt
from PySide6.QtGui import QCloseEvent, QFont
from PySide6.QtWidgets import (
    QApplication,
    QLabel,
    QMainWindow,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from app_config import (
    ANIMATION_MS,
    APP_NAME,
    DEFAULT_URL,
    KEYBOARD_HEIGHT_RATIO,
    KIOSK_LOCK,
)
from browser import CheckoutBrowser
from keyboard import KeyboardPanel


class MainWindow(QMainWindow):
    def __init__(self, windowed=False):
        super().__init__()
        self.windowed = windowed
        self.keyboard_visible = False
        self.animation = None
        self.allow_close = False

        self.setWindowTitle(APP_NAME)
        self.setMinimumSize(720, 1100)

        self.status = QLabel("Carregando Hernandes Checkout...")
        self.status.setObjectName("startupStatus")
        self.status.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status.setFixedHeight(44)

        self.browser = CheckoutBrowser(DEFAULT_URL)
        self.browser.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding,
        )
        self.browser.keyboard_event.connect(self.on_keyboard_event)
        self.browser.loadStarted.connect(
            lambda: self.status.setText("Carregando e-commerce...")
        )
        self.browser.loadProgress.connect(
            lambda p: self.status.setText(f"Carregando e-commerce... {p}%")
        )
        self.browser.loadFinished.connect(self.on_load_finished)

        self.keyboard = KeyboardPanel()
        self.keyboard.request_key.connect(self.browser.send_virtual_key)
        self.keyboard.request_hide.connect(self.hide_keyboard)

        shell = QWidget()
        layout = QVBoxLayout(shell)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self.status, 0)
        layout.addWidget(self.browser, 1)
        layout.addWidget(self.keyboard, 0)
        self.setCentralWidget(shell)

        self.apply_styles()

    def on_load_finished(self, ok):
        if ok:
            self.status.setText("Hernandes Checkout")
            self.status.setFixedHeight(2)
        else:
            self.status.setText(
                "Nao foi possivel carregar o e-commerce - pressione F5 para tentar novamente"
            )
            self.status.setFixedHeight(52)

    def apply_styles(self):
        self.setStyleSheet("""
            QMainWindow {
                background: #ffffff;
            }
            QLabel#startupStatus {
                background: #ffffff;
                color: #7f1d1d;
                font-size: 14px;
                font-weight: 700;
                border-bottom: 1px solid #e5e7eb;
            }
            QWidget#keyboardPanel {
                background: #ffffff;
                border-top: 1px solid #e5e7eb;
            }
            QLabel#keyboardTitle {
                color: #9d171b;
                font-size: 16px;
                font-weight: 800;
            }
            QLabel#keyboardHint {
                color: #6b7280;
                font-size: 12px;
            }
            QPushButton {
                border: 1px solid #d9dde4;
                border-radius: 13px;
                background: #ffffff;
                color: #1f2937;
                font-size: 20px;
                font-weight: 700;
                padding: 8px 10px;
            }
            QPushButton:pressed {
                background: #eceef2;
            }
            QPushButton#primaryKey {
                background: #a7191f;
                color: #ffffff;
                border-color: #a7191f;
            }
            QPushButton#dangerKey {
                background: #fff3f3;
                color: #a7191f;
                border-color: #f0c8ca;
            }
            QPushButton#accentKey,
            QPushButton#spaceKey,
            QPushButton#closeKey {
                background: #f7f7f8;
                color: #4b5563;
            }
            QPushButton#closeKey {
                min-height: 34px;
                max-height: 34px;
                padding: 0 14px;
                font-size: 13px;
            }
        """)

    def target_keyboard_height(self):
        height = int(self.height() * KEYBOARD_HEIGHT_RATIO)
        return max(390, min(height, 720))

    def animate_keyboard(self, target):
        if self.animation is not None:
            self.animation.stop()

        self.animation = QPropertyAnimation(
            self.keyboard,
            b"panelHeight",
            self,
        )
        self.animation.setDuration(ANIMATION_MS)
        self.animation.setStartValue(
            self.keyboard.get_panel_height()
        )
        self.animation.setEndValue(target)
        self.animation.setEasingCurve(
            QEasingCurve.Type.OutCubic
            if target > 0
            else QEasingCurve.Type.InOutCubic
        )
        self.animation.start()

    def show_keyboard(self, kind="text"):
        self.keyboard.set_kind(kind)
        self.keyboard_visible = True
        self.animate_keyboard(self.target_keyboard_height())

    def hide_keyboard(self):
        if (
            not self.keyboard_visible
            and self.keyboard.get_panel_height() == 0
        ):
            return

        self.keyboard_visible = False
        self.animate_keyboard(0)
        self.browser.setFocus(Qt.FocusReason.OtherFocusReason)

    def on_keyboard_event(self, payload):
        event = payload.get("event")
        if event == "show":
            self.show_keyboard(payload.get("kind", "text"))
        elif event == "hide":
            self.hide_keyboard()

    def keyPressEvent(self, event):
        if (
            event.key() == Qt.Key.Key_F12
            and event.modifiers() & Qt.KeyboardModifier.ControlModifier
            and event.modifiers() & Qt.KeyboardModifier.ShiftModifier
        ):
            self.allow_close = True
            self.close()
            return

        if event.key() == Qt.Key.Key_F5:
            self.status.setFixedHeight(44)
            self.browser.reload()
            return

        super().keyPressEvent(event)

    def closeEvent(self, event: QCloseEvent):
        if (
            self.allow_close
            or self.windowed
            or not KIOSK_LOCK
        ):
            event.accept()
        else:
            event.ignore()


def main():
    QApplication.setAttribute(
        Qt.ApplicationAttribute.AA_UseSoftwareOpenGL,
        True,
    )

    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("Grupo Hernandes")
    app.setFont(QFont("Segoe UI", 10))

    windowed = "--windowed" in sys.argv
    window = MainWindow(windowed=windowed)

    if windowed:
        window.resize(900, 1500)
        window.show()
    else:
        window.showFullScreen()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
