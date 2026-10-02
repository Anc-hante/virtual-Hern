import json
import sys
from pathlib import Path

from PySide6.QtCore import QStandardPaths, QTimer, QUrl, Signal
from PySide6.QtWebEngineCore import (
    QWebEnginePage,
    QWebEngineProfile,
    QWebEngineScript,
    QWebEngineSettings,
)
from PySide6.QtWebEngineWidgets import QWebEngineView


def resource_path(relative_path: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative_path


class CheckoutPage(QWebEnginePage):
    keyboard_event = Signal(dict)

    def javaScriptConsoleMessage(self, level, message, line_number, source_id):
        prefix = "__HERN_KB__"
        if message.startswith(prefix):
            try:
                self.keyboard_event.emit(json.loads(message[len(prefix):]))
                return
            except Exception:
                pass
        super().javaScriptConsoleMessage(level, message, line_number, source_id)


class CheckoutBrowser(QWebEngineView):
    keyboard_event = Signal(dict)

    def __init__(self, url: str, parent=None):
        super().__init__(parent)

        app_data = Path(
            QStandardPaths.writableLocation(
                QStandardPaths.StandardLocation.AppDataLocation
            )
        )
        profile_dir = app_data / "browser_profile"
        cache_dir = app_data / "browser_cache"
        profile_dir.mkdir(parents=True, exist_ok=True)
        cache_dir.mkdir(parents=True, exist_ok=True)

        self.profile = QWebEngineProfile("hernandes-kiosk", self)
        self.profile.setPersistentStoragePath(str(profile_dir))
        self.profile.setCachePath(str(cache_dir))
        self.profile.setPersistentCookiesPolicy(
            QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies
        )

        self.checkout_page = CheckoutPage(self.profile, self)
        self.checkout_page.keyboard_event.connect(self.keyboard_event.emit)
        self.setPage(self.checkout_page)

        settings = self.settings()
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.JavascriptEnabled, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.LocalStorageEnabled, True
        )
        settings.setAttribute(
            QWebEngineSettings.WebAttribute.FullScreenSupportEnabled, True
        )

        bridge_source = resource_path(
            "resources/keyboard_bridge.js"
        ).read_text(encoding="utf-8")

        bridge = QWebEngineScript()
        bridge.setName("HernandesKeyboardBridge")
        bridge.setInjectionPoint(
            QWebEngineScript.InjectionPoint.DocumentReady
        )
        bridge.setRunsOnSubFrames(False)
        bridge.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        bridge.setSourceCode(bridge_source)
        self.checkout_page.scripts().insert(bridge)

        self.checkout_page.renderProcessTerminated.connect(
            lambda *_: QTimer.singleShot(800, self.reload)
        )

        self.setUrl(QUrl(url))

    def send_virtual_key(self, action: str, text: str = ""):
        action_json = json.dumps(action, ensure_ascii=False)
        text_json = json.dumps(text, ensure_ascii=False)
        self.checkout_page.runJavaScript(
            "window.__hernandesType && "
            f"window.__hernandesType({action_json}, {text_json});"
        )
