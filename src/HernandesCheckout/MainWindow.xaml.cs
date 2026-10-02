using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace HernandesCheckout;

public partial class MainWindow : Window
{
    private const string HomeUrl = "https://www.grupohernandes.com.br/";
    private const double KeyboardHeight = 458;
    private static readonly TimeSpan InactivityTimeout =
        TimeSpan.FromMinutes(2);

    private bool _allowClose;
    private bool _keyboardVisible;
    private bool _webReady;
    private readonly SemaphoreSlim _scriptLock = new(1, 1);
    private readonly DispatcherTimer _inactivityTimer;

    public MainWindow()
    {
        InitializeComponent();

        _inactivityTimer = new DispatcherTimer
        {
            Interval = InactivityTimeout,
        };

        _inactivityTimer.Tick += InactivityTimer_Tick;

        Loaded += MainWindow_Loaded;
        Keyboard.KeyRequested += Keyboard_KeyRequested;
        Keyboard.HideRequested += Keyboard_HideRequested;
    }

    private async void MainWindow_Loaded(
        object sender,
        RoutedEventArgs e)
    {
        await InitializeWebViewAsync();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            ShowStatus("Preparando checkout...", 5);

            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "GrupoHernandes",
                "VirtualHern",
                "WebView2");

            Directory.CreateDirectory(userDataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: userDataFolder);

            await Browser.EnsureCoreWebView2Async(environment);

            ConfigureWebView();

            await Browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                ReadEmbeddedText("keyboard_bridge.js"));

            await Browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                ReadEmbeddedText("kiosk_session.js"));

            await Browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                ReadEmbeddedText("checkout_flow.js"));

            Browser.CoreWebView2.WebMessageReceived +=
                CoreWebView2_WebMessageReceived;

            Browser.CoreWebView2.NavigationStarting += (_, _) =>
            {
                _webReady = false;

                ShowStatus(
                    "Carregando e-commerce...",
                    12);

                HideKeyboard(
                    animate: false,
                    clearWebFocus: false);
            };

            Browser.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                if (args.IsSuccess)
                {
                    _webReady = true;
                    Browser.Visibility = Visibility.Visible;
                    StartupError.Visibility = Visibility.Collapsed;
                    RestartButton.IsEnabled = true;

                    HideStatus();
                    ResetInactivityTimer();
                }
                else
                {
                    ShowNavigationError(
                        $"Falha ao carregar o e-commerce ({args.WebErrorStatus}).");
                }
            };

            Browser.CoreWebView2.ProcessFailed += (_, args) =>
            {
                ShowNavigationError(
                    $"O navegador foi interrompido ({args.ProcessFailedKind}). " +
                    "Toque em tentar novamente.");
            };

            Browser.Source = new Uri(HomeUrl);
        }
        catch (Exception ex)
        {
            ShowNavigationError(
                "Não foi possível iniciar o Microsoft Edge WebView2. " +
                ex.Message);
        }
    }

    private void ConfigureWebView()
    {
        var settings = Browser.CoreWebView2.Settings;

        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsBuiltInErrorPageEnabled = true;

        Browser.CoreWebView2.Profile.PreferredColorScheme =
            CoreWebView2PreferredColorScheme.Light;
    }

    private static string ReadEmbeddedText(string fileName)
    {
        var assembly = Assembly.GetExecutingAssembly();

        var resourceName = assembly
            .GetManifestResourceNames()
            .Single(name =>
                name.EndsWith(
                    fileName,
                    StringComparison.OrdinalIgnoreCase));

        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException(
                $"Recurso {fileName} não encontrado.");

        using var reader = new StreamReader(stream);

        return reader.ReadToEnd();
    }

    private void CoreWebView2_WebMessageReceived(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var document =
                JsonDocument.Parse(e.WebMessageAsJson);

            var root = document.RootElement;

            if (!root.TryGetProperty("type", out var typeElement))
            {
                return;
            }

            var type = typeElement.GetString();

            if (type == "keyboard")
            {
                HandleKeyboardMessage(root);
                return;
            }

            if (type == "kiosk")
            {
                HandleKioskMessage(root);
                return;
            }

            if (type == "lead")
            {
                SaveLead(root);
                ResetInactivityTimer();
            }
        }
        catch
        {
            // Ignore malformed messages from page scripts.
        }
    }

    private void HandleKeyboardMessage(JsonElement root)
    {
        var action =
            root.TryGetProperty(
                "action",
                out var actionElement)
                ? actionElement.GetString()
                : null;

        ResetInactivityTimer();

        if (action == "show")
        {
            var kind =
                root.TryGetProperty(
                    "kind",
                    out var kindElement)
                    ? kindElement.GetString()
                    : "text";

            Dispatcher.Invoke(
                () => ShowKeyboard(kind ?? "text"));
        }
        else if (action == "hide")
        {
            Dispatcher.Invoke(
                () => HideKeyboard(
                    animate: true,
                    clearWebFocus: false));
        }
    }

    private void HandleKioskMessage(JsonElement root)
    {
        var action =
            root.TryGetProperty(
                "action",
                out var actionElement)
                ? actionElement.GetString()
                : null;

        if (action == "activity")
        {
            ResetInactivityTimer();
            return;
        }

        if (action == "reset-started")
        {
            Dispatcher.Invoke(() =>
            {
                RestartButton.IsEnabled = false;
                ShowStatus(
                    "Reiniciando atendimento...",
                    30);
            });

            return;
        }

        if (action == "reset-complete")
        {
            Dispatcher.Invoke(() =>
            {
                RestartButton.IsEnabled = true;
                ResetInactivityTimer();
            });
        }
    }

    private static string CsvEscape(string value)
    {
        var safe = value.Replace("\"", "\"\"");
        return $"\"{safe}\"";
    }

    private void SaveLead(JsonElement root)
    {
        var name =
            root.TryGetProperty("name", out var nameElement)
                ? nameElement.GetString()?.Trim() ?? string.Empty
                : string.Empty;

        var phone =
            root.TryGetProperty("phone", out var phoneElement)
                ? phoneElement.GetString()?.Trim() ?? string.Empty
                : string.Empty;

        if (string.IsNullOrWhiteSpace(name) ||
            string.IsNullOrWhiteSpace(phone))
        {
            return;
        }

        try
        {
            var folder = Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "GrupoHernandes",
                "VirtualHern");

            Directory.CreateDirectory(folder);

            var filePath =
                Path.Combine(folder, "leads.csv");

            if (!File.Exists(filePath))
            {
                File.WriteAllText(
                    filePath,
                    "data_hora,nome,telefone" +
                    Environment.NewLine,
                    new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
            }

            var line = string.Join(
                ",",
                CsvEscape(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")),
                CsvEscape(name),
                CsvEscape(phone));

            File.AppendAllText(
                filePath,
                line + Environment.NewLine,
                Encoding.UTF8);
        }
        catch
        {
            // The purchase flow must never stop because lead logging failed.
        }
    }

    private void ResetInactivityTimer()
    {
        _inactivityTimer.Stop();
        _inactivityTimer.Start();
    }

    private async void InactivityTimer_Tick(
        object? sender,
        EventArgs e)
    {
        _inactivityTimer.Stop();

        await ResetCheckoutAsync("inactivity");
    }

    private async Task ResetCheckoutAsync(string reason)
    {
        RestartButton.IsEnabled = false;

        ShowStatus(
            reason == "inactivity"
                ? "Atendimento encerrado por inatividade..."
                : "Reiniciando atendimento...",
            25);

        HideKeyboard(
            animate: false,
            clearWebFocus: false);

        if (!_webReady ||
            Browser.CoreWebView2 is null)
        {
            Browser.Source = new Uri(HomeUrl);
            RestartButton.IsEnabled = true;
            return;
        }

        var reasonJson =
            JsonSerializer.Serialize(reason);

        await ExecuteScriptSerialAsync(
            $"window.__hernandesKioskReset?.({reasonJson});");

        // The JS reset can navigate through the site's cart page while it
        // removes items. If the site does not expose a recognizable cart UI,
        // do not leave the kiosk stuck in a reset state forever.
        await Task.Delay(6500);

        if (!RestartButton.IsEnabled &&
            Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2.Navigate(HomeUrl);
            RestartButton.IsEnabled = true;
            ResetInactivityTimer();
        }
    }

    private void ShowKeyboard(string kind)
    {
        Keyboard.SetKind(kind);

        if (_keyboardVisible)
        {
            _ = EnsureTargetVisibleAsync();
            return;
        }

        _keyboardVisible = true;
        KeyboardContainer.IsHitTestVisible = true;

        AnimateKeyboardHeight(
            KeyboardHeight,
            milliseconds: 135);

        AnimateOpacity(
            KeyboardContainer,
            KeyboardContainer.Opacity,
            1,
            milliseconds: 95);

        _ = EnsureTargetVisibleAsync();
    }

    private void HideKeyboard(
        bool animate,
        bool clearWebFocus)
    {
        if (!_keyboardVisible &&
            KeyboardContainer.ActualHeight < 1)
        {
            return;
        }

        _keyboardVisible = false;
        KeyboardContainer.IsHitTestVisible = false;

        if (animate)
        {
            AnimateKeyboardHeight(
                0,
                milliseconds: 115);

            AnimateOpacity(
                KeyboardContainer,
                KeyboardContainer.Opacity,
                0,
                milliseconds: 85);
        }
        else
        {
            KeyboardContainer.BeginAnimation(
                HeightProperty,
                null);

            KeyboardContainer.Height = 0;
            KeyboardContainer.Opacity = 0;
        }

        if (clearWebFocus)
        {
            _ = ExecuteScriptSerialAsync(
                "window.__hernandesKeyboardDismiss?.();");
        }
    }

    private void AnimateKeyboardHeight(
        double target,
        int milliseconds)
    {
        KeyboardContainer.BeginAnimation(
            HeightProperty,
            null);

        var current = KeyboardContainer.ActualHeight;

        var animation = new DoubleAnimation
        {
            From = current,
            To = target,
            Duration =
                TimeSpan.FromMilliseconds(milliseconds),
            EasingFunction = new CubicEase
            {
                EasingMode = EasingMode.EaseOut,
            },
            FillBehavior = FillBehavior.Stop,
        };

        animation.Completed += (_, _) =>
        {
            KeyboardContainer.BeginAnimation(
                HeightProperty,
                null);

            KeyboardContainer.Height = target;
        };

        KeyboardContainer.BeginAnimation(
            HeightProperty,
            animation,
            HandoffBehavior.SnapshotAndReplace);
    }

    private static void AnimateOpacity(
        UIElement target,
        double from,
        double to,
        int milliseconds)
    {
        var animation = new DoubleAnimation
        {
            From = from,
            To = to,
            Duration =
                TimeSpan.FromMilliseconds(milliseconds),
            EasingFunction = new CubicEase
            {
                EasingMode = EasingMode.EaseOut,
            },
            FillBehavior = FillBehavior.HoldEnd,
        };

        target.BeginAnimation(
            OpacityProperty,
            animation,
            HandoffBehavior.SnapshotAndReplace);
    }

    private async Task EnsureTargetVisibleAsync()
    {
        await Task.Delay(95);

        await ExecuteScriptSerialAsync(
            "window.__hernandesEnsureTargetVisible?.();");
    }

    private async void Keyboard_KeyRequested(
        object? sender,
        VirtualKeyEventArgs e)
    {
        ResetInactivityTimer();

        var action =
            JsonSerializer.Serialize(e.Action);

        var text =
            JsonSerializer.Serialize(e.Text);

        await ExecuteScriptSerialAsync(
            $"window.__hernandesType?.({action}, {text});");
    }

    private void Keyboard_HideRequested(
        object? sender,
        EventArgs e)
    {
        ResetInactivityTimer();

        HideKeyboard(
            animate: true,
            clearWebFocus: true);
    }

    private async Task ExecuteScriptSerialAsync(string script)
    {
        if (!_webReady ||
            Browser.CoreWebView2 is null)
        {
            return;
        }

        await _scriptLock.WaitAsync();

        try
        {
            await Browser.CoreWebView2.ExecuteScriptAsync(script);
        }
        catch
        {
            // Navigation can replace the document between taps.
        }
        finally
        {
            _scriptLock.Release();
        }
    }

    private void ShowStatus(
        string text,
        double progress)
    {
        StatusText.Text = text;
        LoadProgress.Visibility = Visibility.Visible;
        LoadProgress.Value = progress;
        StatusBar.Visibility = Visibility.Visible;
    }

    private void HideStatus()
    {
        StatusText.Text = "Pronto para atendimento";
        LoadProgress.Value = 0;
        LoadProgress.Visibility = Visibility.Collapsed;
        StatusBar.Visibility = Visibility.Visible;
    }

    private void ShowNavigationError(string text)
    {
        _webReady = false;
        _inactivityTimer.Stop();

        HideKeyboard(
            animate: false,
            clearWebFocus: false);

        Browser.Visibility = Visibility.Collapsed;
        ErrorText.Text = text;
        StartupError.Visibility = Visibility.Visible;

        StatusText.Text = "Erro no e-commerce";
        LoadProgress.Visibility = Visibility.Collapsed;
        StatusBar.Visibility = Visibility.Visible;

        RestartButton.IsEnabled = true;
    }

    private async void RetryButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        StartupError.Visibility = Visibility.Collapsed;
        Browser.Visibility = Visibility.Visible;

        if (Browser.CoreWebView2 is null)
        {
            await InitializeWebViewAsync();
            return;
        }

        Browser.CoreWebView2.Navigate(HomeUrl);
    }

    private async void RestartButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        ResetInactivityTimer();
        await ResetCheckoutAsync("manual");
    }

    private void Window_KeyDown(
        object sender,
        KeyEventArgs e)
    {
        ResetInactivityTimer();

        var modifiers =
            System.Windows.Input.Keyboard.Modifiers;

        if (modifiers.HasFlag(ModifierKeys.Control) &&
            modifiers.HasFlag(ModifierKeys.Shift) &&
            e.Key == Key.F12)
        {
            _allowClose = true;
            Close();
            return;
        }

        if (e.Key == Key.F5 &&
            Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2.Reload();
            e.Handled = true;
        }
    }

    private void Window_Closing(
        object? sender,
        CancelEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
        }
    }
}
