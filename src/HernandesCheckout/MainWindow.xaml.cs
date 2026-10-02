using System.ComponentModel;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;
using Microsoft.Web.WebView2.Core;

namespace HernandesCheckout;

public partial class MainWindow : Window
{
    private const string HomeUrl = "https://www.grupohernandes.com.br/";
    private const double KeyboardHiddenY = 500;

    private bool _allowClose;
    private bool _keyboardVisible;
    private bool _webReady;
    private readonly SemaphoreSlim _scriptLock = new(1, 1);

    public MainWindow()
    {
        InitializeComponent();

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
                ReadEmbeddedText("checkout_flow.js"));

            Browser.CoreWebView2.WebMessageReceived +=
                CoreWebView2_WebMessageReceived;

            Browser.CoreWebView2.NavigationStarting += (_, _) =>
            {
                ShowStatus("Carregando e-commerce...", 12);
                HideKeyboard(animate: false, clearWebFocus: false);
            };

            Browser.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                if (args.IsSuccess)
                {
                    _webReady = true;
                    HideStatus();
                    StartupError.Visibility = Visibility.Collapsed;
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
                name.EndsWith(fileName, StringComparison.OrdinalIgnoreCase));

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
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;

            if (!root.TryGetProperty("type", out var type) ||
                type.GetString() != "keyboard")
            {
                return;
            }

            var action = root.TryGetProperty("action", out var actionElement)
                ? actionElement.GetString()
                : null;

            if (action == "show")
            {
                var kind = root.TryGetProperty("kind", out var kindElement)
                    ? kindElement.GetString()
                    : "text";

                Dispatcher.Invoke(() => ShowKeyboard(kind ?? "text"));
            }
            else if (action == "hide")
            {
                Dispatcher.Invoke(
                    () => HideKeyboard(
                        animate: true,
                        clearWebFocus: false));
            }
        }
        catch
        {
            // Ignore malformed messages from page scripts.
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

        Animate(
            KeyboardTranslate,
            TranslateTransform.YProperty,
            KeyboardTranslate.Y,
            0,
            150);

        Animate(
            KeyboardContainer,
            OpacityProperty,
            KeyboardContainer.Opacity,
            1,
            110);

        _ = EnsureTargetVisibleAsync();
    }

    private void HideKeyboard(
        bool animate,
        bool clearWebFocus)
    {
        if (!_keyboardVisible &&
            Math.Abs(KeyboardTranslate.Y - KeyboardHiddenY) < 1)
        {
            return;
        }

        _keyboardVisible = false;
        KeyboardContainer.IsHitTestVisible = false;

        if (animate)
        {
            Animate(
                KeyboardTranslate,
                TranslateTransform.YProperty,
                KeyboardTranslate.Y,
                KeyboardHiddenY,
                125);

            Animate(
                KeyboardContainer,
                OpacityProperty,
                KeyboardContainer.Opacity,
                0,
                95);
        }
        else
        {
            KeyboardTranslate.Y = KeyboardHiddenY;
            KeyboardContainer.Opacity = 0;
        }

        if (clearWebFocus)
        {
            _ = ExecuteScriptSerialAsync(
                "window.__hernandesKeyboardDismiss?.();");
        }
    }

    private static void Animate(
        System.Windows.DependencyObject target,
        DependencyProperty property,
        double from,
        double to,
        int milliseconds)
    {
        var animation = new DoubleAnimation
        {
            From = from,
            To = to,
            Duration = TimeSpan.FromMilliseconds(milliseconds),
            EasingFunction = new CubicEase
            {
                EasingMode = EasingMode.EaseOut,
            },
            FillBehavior = FillBehavior.HoldEnd,
        };

        target.BeginAnimation(property, animation);
    }

    private async Task EnsureTargetVisibleAsync()
    {
        await Task.Delay(85);
        await ExecuteScriptSerialAsync(
            "window.__hernandesEnsureTargetVisible?.();");
    }

    private async void Keyboard_KeyRequested(
        object? sender,
        VirtualKeyEventArgs e)
    {
        var action = JsonSerializer.Serialize(e.Action);
        var text = JsonSerializer.Serialize(e.Text);

        await ExecuteScriptSerialAsync(
            $"window.__hernandesType?.({action}, {text});");
    }

    private void Keyboard_HideRequested(
        object? sender,
        EventArgs e)
    {
        HideKeyboard(
            animate: true,
            clearWebFocus: true);
    }

    private async Task ExecuteScriptSerialAsync(string script)
    {
        if (!_webReady || Browser.CoreWebView2 is null)
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
            // Navigation may replace the document between key taps.
        }
        finally
        {
            _scriptLock.Release();
        }
    }

    private void ShowStatus(string text, double progress)
    {
        StatusText.Text = text;
        LoadProgress.Value = progress;
        StatusBar.Visibility = Visibility.Visible;
    }

    private void HideStatus()
    {
        LoadProgress.Value = 100;
        StatusBar.Visibility = Visibility.Collapsed;
    }

    private void ShowNavigationError(string text)
    {
        _webReady = false;
        HideKeyboard(animate: false, clearWebFocus: false);

        ErrorText.Text = text;
        StartupError.Visibility = Visibility.Visible;
        StatusBar.Visibility = Visibility.Collapsed;
    }

    private async void RetryButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        StartupError.Visibility = Visibility.Collapsed;

        if (Browser.CoreWebView2 is null)
        {
            await InitializeWebViewAsync();
            return;
        }

        Browser.CoreWebView2.Navigate(HomeUrl);
    }

    private void Window_KeyDown(
        object sender,
        KeyEventArgs e)
    {
        if (System.Windows.Input.Keyboard.Modifiers.HasFlag(ModifierKeys.Control) &&
            System.Windows.Input.Keyboard.Modifiers.HasFlag(ModifierKeys.Shift) &&
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
