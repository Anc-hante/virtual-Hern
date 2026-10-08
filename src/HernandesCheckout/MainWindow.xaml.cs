using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
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
    private bool _hasSuccessfulNavigation;
    private bool _completionLocked;
    private bool _sessionStartedSent;
    private bool _startNewSessionOnNextHome;
    private string _totemSessionId = Guid.NewGuid().ToString("N");
    private readonly SemaphoreSlim _scriptLock = new(1, 1);
    private readonly DispatcherTimer _inactivityTimer;
    private readonly TotemApiClient _totemApi = new();

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

            Browser.CoreWebView2.HistoryChanged += (_, _) =>
            {
                Dispatcher.Invoke(UpdateBackButton);
            };

            Browser.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (_completionLocked)
                {
                    args.Cancel = true;
                    return;
                }

                _webReady = false;

                // Only show a loading state during the very first startup.
                // Normal page-to-page navigation should feel like a browser,
                // not like the application is restarting every time.
                if (!_hasSuccessfulNavigation)
                {
                    ShowStatus(
                        "Abrindo checkout...",
                        12);
                }
                else
                {
                    StatusText.Text = "Pronto para atendimento";
                    LoadProgress.Visibility = Visibility.Collapsed;
                }

                if (_keyboardVisible)
                {
                    HideKeyboard(
                        animate: false,
                        clearWebFocus: false);
                }
            };

            Browser.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                if (args.IsSuccess)
                {
                    _webReady = true;
                    _hasSuccessfulNavigation = true;
                    Browser.Visibility = Visibility.Visible;
                    StartupError.Visibility = Visibility.Collapsed;
                    RestartButton.IsEnabled = true;

                    HideStatus();
                    UpdateBackButton();
                    ResetInactivityTimer();
                    _ = OnNavigationReadyAsync();
                    return;
                }

                // Login, redirects and SPA transitions can cancel an older
                // navigation while the next one is already loading. That is
                // normal WebView2 behavior and must never become a customer
                // facing "failed to load" popup.
                if (
                    args.WebErrorStatus ==
                    CoreWebView2WebErrorStatus.OperationCanceled)
                {
                    return;
                }

                // Once the storefront has loaded successfully at least once,
                // keep transient navigation failures silent. A following
                // redirect/navigation will complete normally and restore the
                // ready state. This avoids flashing a technical error during
                // login and checkout transitions.
                if (_hasSuccessfulNavigation)
                {
                    _webReady = true;
                    Browser.Visibility = Visibility.Visible;
                    StartupError.Visibility = Visibility.Collapsed;
                    RestartButton.IsEnabled = true;
                    UpdateBackButton();
                    HideStatus();
                    return;
                }

                ShowNavigationError(
                    "Não foi possível abrir o e-commerce. " +
                    "Verifique a conexão e tente novamente.");
            };

            Browser.CoreWebView2.ProcessFailed += (_, _) =>
            {
                if (_hasSuccessfulNavigation)
                {
                    Browser.Visibility = Visibility.Visible;
                    StartupError.Visibility = Visibility.Collapsed;
                    RestartButton.IsEnabled = true;
                    return;
                }

                ShowNavigationError(
                    "Não foi possível iniciar o e-commerce. " +
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
                return;
            }

            if (type == "totem_event")
            {
                var eventMessage = root.Clone();
                _ = HandleTotemEventAsync(eventMessage);
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

        if (action == "completion-lock")
        {
            Dispatcher.Invoke(ShowCompletionScreen);
            return;
        }

        if (action == "completion-release")
        {
            _completionLocked = false;
            _startNewSessionOnNextHome = true;
            UpdateBackButton();
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

    private void ShowCompletionScreen()
    {
        if (CompletionScreen.Visibility == Visibility.Visible)
        {
            return;
        }

        _completionLocked = true;
        _inactivityTimer.Stop();

        HideKeyboard(
            animate: false,
            clearWebFocus: false);

        BackButton.IsEnabled = false;
        RestartButton.IsEnabled = false;

        Browser.Visibility = Visibility.Collapsed;
        StartupError.Visibility = Visibility.Collapsed;
        CompletionScreen.Visibility = Visibility.Visible;

        StatusText.Text = "Pedido finalizado";
        LoadProgress.Visibility = Visibility.Collapsed;

        Dispatcher.BeginInvoke(
            new Action(StartCompletionConfetti),
            DispatcherPriority.Loaded);
    }

    private void StartCompletionConfetti()
    {
        ConfettiCanvas.Children.Clear();

        var width = Math.Max(
            720,
            CompletionScreen.ActualWidth);

        var height = Math.Max(
            1100,
            CompletionScreen.ActualHeight);

        var brushes = new Brush[]
        {
            new SolidColorBrush(Color.FromRgb(167, 25, 31)),
            new SolidColorBrush(Color.FromRgb(213, 43, 50)),
            new SolidColorBrush(Color.FromRgb(246, 195, 68)),
            new SolidColorBrush(Color.FromRgb(46, 155, 80)),
            Brushes.White,
        };

        for (var index = 0; index < 44; index += 1)
        {
            var piece = new Rectangle
            {
                Width = Random.Shared.Next(7, 14),
                Height = Random.Shared.Next(11, 21),
                RadiusX = 1.5,
                RadiusY = 1.5,
                Fill = brushes[index % brushes.Length],
                Opacity = 0.95,
                RenderTransformOrigin =
                    new Point(0.5, 0.5),
            };

            var rotate =
                new RotateTransform();

            piece.RenderTransform = rotate;

            var left =
                Random.Shared.NextDouble() *
                Math.Max(1, width - 20);

            Canvas.SetLeft(piece, left);
            Canvas.SetTop(piece, -30);

            ConfettiCanvas.Children.Add(piece);

            var delay =
                TimeSpan.FromMilliseconds(
                    Random.Shared.Next(0, 500));

            var duration =
                TimeSpan.FromMilliseconds(
                    Random.Shared.Next(1750, 2950));

            var fall = new DoubleAnimation
            {
                From = -30,
                To = height + 40,
                BeginTime = delay,
                Duration = duration,
                EasingFunction = new QuadraticEase
                {
                    EasingMode =
                        EasingMode.EaseIn,
                },
                FillBehavior =
                    FillBehavior.Stop,
            };

            var spin = new DoubleAnimation
            {
                From = 0,
                To = Random.Shared.Next(420, 1080),
                BeginTime = delay,
                Duration = duration,
                FillBehavior =
                    FillBehavior.Stop,
            };

            var fade = new DoubleAnimation
            {
                From = 0.95,
                To = 0.08,
                BeginTime =
                    delay +
                    TimeSpan.FromMilliseconds(900),
                Duration =
                    TimeSpan.FromMilliseconds(1200),
                FillBehavior =
                    FillBehavior.Stop,
            };

            piece.BeginAnimation(
                Canvas.TopProperty,
                fall);

            rotate.BeginAnimation(
                RotateTransform.AngleProperty,
                spin);

            piece.BeginAnimation(
                OpacityProperty,
                fade);
        }
    }

    private void CompletionHomeButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        ConfettiCanvas.Children.Clear();
        CompletionScreen.Visibility =
            Visibility.Collapsed;

        _completionLocked = false;
        _startNewSessionOnNextHome = true;

        Browser.Visibility = Visibility.Visible;
        RestartButton.IsEnabled = true;

        StatusText.Text =
            "Pronto para atendimento";

        LoadProgress.Visibility =
            Visibility.Collapsed;

        if (Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2.Navigate(
                HomeUrl);
        }
        else
        {
            Browser.Source =
                new Uri(HomeUrl);
        }

        ResetInactivityTimer();
    }

    private async Task HandleTotemEventAsync(
        JsonElement message)
    {
        try
        {
            await _totemApi.SendWebEventAsync(
                message,
                _totemSessionId);

            if (message.TryGetProperty(
                    "event_type",
                    out var eventTypeElement) &&
                eventTypeElement.GetString() == "order_completed")
            {
                _startNewSessionOnNextHome = true;
            }
        }
        catch
        {
            // The API client already persists failed sends locally.
        }
    }

    private async Task OnNavigationReadyAsync()
    {
        try
        {
            await _totemApi.FlushPendingAsync();

            if (_startNewSessionOnNextHome &&
                IsHomeUrl(Browser.Source))
            {
                _totemSessionId =
                    Guid.NewGuid().ToString("N");

                _sessionStartedSent = false;
                _startNewSessionOnNextHome = false;
            }

            if (_sessionStartedSent)
            {
                return;
            }

            _sessionStartedSent = true;

            await _totemApi.SendSimpleEventAsync(
                "session_started",
                _totemSessionId,
                new Dictionary<string, object?>
                {
                    ["url"] = Browser.Source?.ToString(),
                    ["app_version"] =
                        Assembly.GetExecutingAssembly()
                            .GetName()
                            .Version
                            ?.ToString(),
                });
        }
        catch
        {
            _sessionStartedSent = false;
        }
    }

    private static bool IsHomeUrl(Uri? uri)
    {
        if (uri is null)
        {
            return false;
        }

        return string.Equals(
                   uri.Host,
                   "www.grupohernandes.com.br",
                   StringComparison.OrdinalIgnoreCase)
               &&
               (uri.AbsolutePath == "/" ||
                string.IsNullOrWhiteSpace(uri.AbsolutePath));
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
        _completionLocked = false;
        RestartButton.IsEnabled = false;

        ShowStatus(
            reason == "inactivity"
                ? "Atendimento encerrado por inatividade..."
                : "Reiniciando atendimento...",
            25);

        HideKeyboard(
            animate: false,
            clearWebFocus: false);

        await _totemApi.SendSimpleEventAsync(
            reason == "inactivity"
                ? "inactivity_reset"
                : "session_reset",
            _totemSessionId,
            new Dictionary<string, object?>
            {
                ["reason"] = reason,
            });

        _startNewSessionOnNextHome = true;

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

        // Resize WebView2 only once. Animating Height frame-by-frame forces
        // the native browser surface to recompute its layout dozens of times
        // and was the main source of visible stutter on the kiosk.
        KeyboardContainer.BeginAnimation(
            HeightProperty,
            null);

        KeyboardContainer.Height = KeyboardHeight;
        KeyboardContainer.Opacity = 0;

        AnimateOpacity(
            KeyboardContainer,
            0,
            1,
            milliseconds: 85);

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
            var fade = new DoubleAnimation
            {
                From = KeyboardContainer.Opacity,
                To = 0,
                Duration = TimeSpan.FromMilliseconds(70),
                EasingFunction = new CubicEase
                {
                    EasingMode = EasingMode.EaseOut,
                },
                FillBehavior = FillBehavior.Stop,
            };

            fade.Completed += (_, _) =>
            {
                KeyboardContainer.BeginAnimation(
                    OpacityProperty,
                    null);

                KeyboardContainer.Opacity = 0;

                KeyboardContainer.BeginAnimation(
                    HeightProperty,
                    null);

                // One WebView2 resize after the fade, instead of resizing
                // the native browser surface on every animation frame.
                KeyboardContainer.Height = 0;
            };

            KeyboardContainer.BeginAnimation(
                OpacityProperty,
                fade,
                HandoffBehavior.SnapshotAndReplace);
        }
        else
        {
            KeyboardContainer.BeginAnimation(
                HeightProperty,
                null);

            KeyboardContainer.BeginAnimation(
                OpacityProperty,
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

    private void UpdateBackButton()
    {
        BackButton.IsEnabled =
            !_completionLocked &&
            Browser.CoreWebView2 is not null &&
            Browser.CoreWebView2.CanGoBack;
    }

    private void BackButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        ResetInactivityTimer();

        if (_completionLocked ||
            Browser.CoreWebView2 is null ||
            !Browser.CoreWebView2.CanGoBack)
        {
            UpdateBackButton();
            return;
        }

        HideKeyboard(
            animate: false,
            clearWebFocus: false);

        Browser.CoreWebView2.GoBack();
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
