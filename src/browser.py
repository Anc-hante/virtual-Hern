import json
import sys
from pathlib import Path

from PySide6.QtCore import QStandardPaths, QTimer, QUrl, Signal
from PySide6.QtGui import QColor
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
        self.setStyleSheet("background: #ffffff;")

        app_data = Path(
            QStandardPaths.writableLocation(
                QStandardPaths.StandardLocation.AppDataLocation
            )
        )
        profile_dir = app_data / "browser_profile"
        cache_dir = app_data / "browser_cache"
        profile_dir.mkdir(parents=True, exist_ok=True)
        cache_dir.mkdir(parents=True, exist_ok=True)

        # A named, disk-backed profile keeps authentication cookies,
        # local storage, IndexedDB and the HTTP cache between executions.
        self.profile = QWebEngineProfile("hernandes-kiosk", self)
        self.profile.setPersistentStoragePath(str(profile_dir))
        self.profile.setCachePath(str(cache_dir))
        self.profile.setHttpCacheType(
            QWebEngineProfile.HttpCacheType.DiskHttpCache
        )
        self.profile.setHttpCacheMaximumSize(256 * 1024 * 1024)
        self.profile.setPersistentCookiesPolicy(
            QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies
        )
        self.profile.cookieStore().loadAllCookies()

        self.checkout_page = CheckoutPage(self.profile, self)
        self.checkout_page.setBackgroundColor(QColor("#ffffff"))
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

        self.install_script(
            name="HernandesKeyboardBridge",
            filename="keyboard_bridge.js",
        )
        self.install_script(
            name="HernandesCheckoutFlow",
            filename="checkout_flow.js",
        )

        self.checkout_page.renderProcessTerminated.connect(
            lambda *_: QTimer.singleShot(800, self.reload)
        )

        self.setUrl(QUrl(url))

    def install_script(self, name: str, filename: str):
        source = resource_path(
            f"resources/{filename}"
        ).read_text(encoding="utf-8")

        script = QWebEngineScript()
        script.setName(name)
        script.setInjectionPoint(
            QWebEngineScript.InjectionPoint.DocumentReady
        )
        script.setRunsOnSubFrames(False)
        script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        script.setSourceCode(source)
        self.checkout_page.scripts().insert(script)

    def send_virtual_key(self, action: str, text: str = ""):
        action_json = json.dumps(action, ensure_ascii=False)
        text_json = json.dumps(text, ensure_ascii=False)
        self.checkout_page.runJavaScript(
            "window.__hernandesType && "
            f"window.__hernandesType({action_json}, {text_json});"
        )
