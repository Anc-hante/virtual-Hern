using System.Windows;
using System.Windows.Controls;

namespace HernandesCheckout;

public partial class VirtualKeyboard : UserControl
{
    public event EventHandler<VirtualKeyEventArgs>? KeyRequested;
    public event EventHandler? HideRequested;

    private string _kind = "text";
    private bool _shiftActive;

    public VirtualKeyboard()
    {
        InitializeComponent();
        BuildLayout("text");
    }

    public void SetKind(string? kind)
    {
        kind = kind is "email" or "numeric" ? kind : "text";

        if (_kind == kind)
        {
            return;
        }

        _shiftActive = false;
        BuildLayout(kind);
    }

    private string LetterText(char character)
    {
        var value = character.ToString();

        return _shiftActive
            ? value.ToUpperInvariant()
            : value.ToLowerInvariant();
    }

    private void BuildLayout(string kind)
    {
        _kind = kind;
        RowsHost.Children.Clear();

        if (kind == "numeric")
        {
            AddRow(new[]
            {
                Key("1", "text", "1", "number"),
                Key("2", "text", "2", "number"),
                Key("3", "text", "3", "number"),
            });

            AddRow(new[]
            {
                Key("4", "text", "4", "number"),
                Key("5", "text", "5", "number"),
                Key("6", "text", "6", "number"),
            });

            AddRow(new[]
            {
                Key("7", "text", "7", "number"),
                Key("8", "text", "8", "number"),
                Key("9", "text", "9", "number"),
            });

            AddRow(new[]
            {
                Key("APAGAR", "backspace", "", "danger", 1.3),
                Key("0", "text", "0", "number"),
                Key("OK ↵", "enter", "", "primary", 1.3),
            });

            return;
        }

        AddRow("1234567890"
            .Select(c => Key(
                c.ToString(),
                "text",
                c.ToString(),
                "number"))
            .ToArray());

        AddRow("QWERTYUIOP"
            .Select(c => Key(
                _shiftActive
                    ? c.ToString().ToUpperInvariant()
                    : c.ToString().ToLowerInvariant(),
                "text",
                LetterText(c)))
            .ToArray());

        AddRow("ASDFGHJKLÇ"
            .Select(c => Key(
                _shiftActive
                    ? c.ToString().ToUpperInvariant()
                    : c.ToString().ToLowerInvariant(),
                "text",
                LetterText(c)))
            .ToArray());

        var third = new List<KeySpec>
        {
            Key(
                _shiftActive ? "⇧ SHIFT" : "⇧ Shift",
                "shift",
                "",
                _shiftActive ? "shiftActive" : "shift",
                1.55),
        };

        third.AddRange("ZXCVBNM"
            .Select(c => Key(
                _shiftActive
                    ? c.ToString().ToUpperInvariant()
                    : c.ToString().ToLowerInvariant(),
                "text",
                LetterText(c))));

        AddRow(third.ToArray());

        AddRow(new[]
        {
            kind == "email"
                ? Key("@", "text", "@", "number", 0.9)
                : Key("/", "text", "/", "number", 0.9),
            Key(",", "text", ",", "number", 0.75),
            Key(".", "text", ".", "number", 0.75),
            Key("-", "text", "-", "number", 0.75),
            Key("ESPAÇO", "text", " ", "normal", 4.2),
            Key("APAGAR", "backspace", "", "danger", 1.65),
            Key("OK ↵", "enter", "", "primary", 1.65),
        });
    }

    private static KeySpec Key(
        string label,
        string action,
        string text,
        string style = "normal",
        double weight = 1.0)
        => new(label, action, text, style, weight);

    private void AddRow(IReadOnlyList<KeySpec> keys)
    {
        var grid = new Grid
        {
            Margin = new Thickness(0, 2, 0, 2),
            Height = 62,
        };

        foreach (var key in keys)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition
            {
                Width = new GridLength(
                    key.Weight,
                    GridUnitType.Star),
            });
        }

        for (var index = 0; index < keys.Count; index++)
        {
            var spec = keys[index];

            var button = new Button
            {
                Content = spec.Label,
                Tag = spec,
                Focusable = false,
                Style = ResolveStyle(spec.Style),
            };

            button.Click += KeyButton_Click;

            Grid.SetColumn(button, index);
            grid.Children.Add(button);
        }

        RowsHost.Children.Add(grid);
    }

    private Style ResolveStyle(string style)
    {
        var key = style switch
        {
            "number" => "NumberKeyStyle",
            "danger" => "DangerKeyStyle",
            "primary" => "PrimaryKeyStyle",
            "shift" => "ShiftKeyStyle",
            "shiftActive" => "ShiftActiveKeyStyle",
            _ => "TouchKeyStyle",
        };

        return (Style)Application.Current.FindResource(key);
    }

    private void KeyButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        if (sender is not Button { Tag: KeySpec spec })
        {
            return;
        }

        if (spec.Action == "shift")
        {
            _shiftActive = !_shiftActive;
            BuildLayout(_kind);
            return;
        }

        KeyRequested?.Invoke(
            this,
            new VirtualKeyEventArgs(
                spec.Action,
                spec.Text));
    }

    private void CloseButton_Click(
        object sender,
        RoutedEventArgs e)
        => HideRequested?.Invoke(this, EventArgs.Empty);

    private sealed record KeySpec(
        string Label,
        string Action,
        string Text,
        string Style,
        double Weight);
}

public sealed class VirtualKeyEventArgs : EventArgs
{
    public VirtualKeyEventArgs(
        string action,
        string text)
    {
        Action = action;
        Text = text;
    }

    public string Action { get; }
    public string Text { get; }
}
