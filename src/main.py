import os
import sys

COMPATIBILITY_MODE = "--compatibility" in sys.argv

# Configure graphics before importing PySide6.
# Normal mode uses Windows D3D11/ANGLE for smoother scrolling and animation.
# If a device renders a black WebEngine surface, the app automatically
# relaunches once in software compatibility mode.
os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "1"

if COMPATIBILITY_MODE:
    os.environ["QT_OPENGL"] = "software"
    os.environ["QT_QUICK_BACKEND"] = "software"
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (
        "--disable-gpu "
        "--disable-gpu-compositing "
        "--disable-features=Vulkan"
    )
else:
    os.environ["QT_OPENGL"] = "angle"
    os.environ.pop("QT_QUICK_BACKEND", None)
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (
        "--use-angle=d3d11 "
        "--disable-features=Vulkan"
    )

from PySide6.QtCore import (
    QEasingCurve,
    QProcess,
    QPropertyAnimation,
    QTimer,
    Qt,
)
from PySide6.QtGui import QCloseEvent, QFont
from PySide6.QtWidgets import (
    QApplication,
    QLabel,
    QMainWindow,
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
        self.compatibility_mode = COMPATIBILITY_MODE
        self.black_surface_checked = False

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
        self.browser.loadStarted.connect(self.on_load_started)
        self.browser.loadProgress.connect(self.on_load_progress)
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

    def on_load_started(self):
        self.status.setFixedHeight(44)
        self.status.setText("Carregando e-commerce...")

    def on_load_progress(self, progress):
        if self.status.height() > 2:
            self.status.setText(
                f"Carregando e-commerce... {progress}%"
            )

    def on_load_finished(self, ok):
        if ok:
            self.status.setText("Hernandes Checkout")
            self.status.setFixedHeight(2)

            if (
                not self.compatibility_mode
                and not self.black_surface_checked
            ):
                self.black_surface_checked = True
                QTimer.singleShot(
                    2200,
                    self.check_black_webview,
                )
        else:
            self.status.setText(
                "Nao foi possivel carregar o e-commerce - pressione F5 para tentar novamente"
            )
            self.status.setFixedHeight(52)

    def check_black_webview(self):
        image = self.browser.grab().toImage()
        if image.isNull() or image.width() < 50 or image.height() < 50:
            return

        dark = 0
        total = 0
        columns = 10
        rows = 14

        for row in range(1, rows):
            y = int(image.height() * row / rows)
            for column in range(1, columns):
                x = int(image.width() * column / columns)
                color = image.pixelColor(x, y)
                total += 1
                if (
                    color.red() < 18
                    and color.green() < 18
                    and color.blue() < 18
                ):
                    dark += 1

        if total and (dark / total) > 0.92:
            self.restart_in_compatibility_mode()

    def restart_in_compatibility_mode(self):
        self.status.setFixedHeight(52)
        self.status.setText(
            "Ajustando compatibilidade grafica..."
        )

        if getattr(sys, "frozen", False):
            program = sys.executable
            arguments = [
                arg
                for arg in sys.argv[1:]
                if arg != "--compatibility"
            ]
            arguments.append("--compatibility")
        else:
            program = sys.executable
            arguments = [
                sys.argv[0],
                *[
                    arg
                    for arg in sys.argv[1:]
                    if arg != "--compatibility"
                ],
                "--compatibility",
            ]

        if QProcess.startDetached(program, arguments):
            self.allow_close = True
            QTimer.singleShot(150, self.close)

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
                background: #f3f4f6;
                border-top: 3px solid #a7191f;
            }

            QWidget#keysHost,
            QWidget#keyRow {
                background: transparent;
            }

            QLabel#keyboardTitle {
                color: #7f1d1d;
                font-size: 13px;
                font-weight: 800;
            }

            QWidget#keyboardPanel QPushButton {
                min-width: 0;
                border-radius: 13px;
                border: 1px solid #d9dee5;
                background: #ffffff;
                color: #242a31;
                font-size: 18px;
                font-weight: 700;
                padding: 6px 6px;
            }

            QWidget#keyboardPanel QPushButton:pressed {
                background: #dfe3e8;
                border-color: #c9cfd7;
            }

            QPushButton#numberKey {
                background: #e9edf2;
                color: #303741;
                border-color: #d6dce4;
            }

            QPushButton#symbolKey,
            QPushButton#accentKey {
                background: #e9edf2;
                color: #4b5563;
                border-color: #d6dce4;
            }

            QPushButton#spaceKey {
                background: #ffffff;
                color: #4b5563;
            }

            QPushButton#dangerKey {
                background: #e2e5e9;
                color: #343a40;
                border-color: #d1d6dc;
            }

            QPushButton#primaryKey {
                background: #a7191f;
                color: #ffffff;
                border-color: #a7191f;
                font-weight: 800;
            }

            QPushButton#primaryKey:pressed {
                background: #851419;
                border-color: #851419;
            }

            QPushButton#closeKey {
                background: transparent;
                color: #6b7280;
                border: 0;
                border-radius: 17px;
                font-size: 28px;
                font-weight: 400;
                padding: 0;
            }

            QPushButton#closeKey:pressed {
                background: #e5e7eb;
            }
        """)

    def target_keyboard_height(self):
        height = int(self.height() * KEYBOARD_HEIGHT_RATIO)
        return max(410, min(height, 720))

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
    if COMPATIBILITY_MODE:
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
