using System.Windows;
using System.Windows.Controls;

namespace HernandesCheckout;

public partial class VirtualKeyboard : UserControl
{
    public event EventHandler<VirtualKeyEventArgs>? KeyRequested;
    public event EventHandler? HideRequested;

    private string _kind = "text";

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

        BuildLayout(kind);
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
                Key("OK", "enter", "", "primary", 1.3),
            });
            return;
        }

        AddRow("1234567890"
            .Select(c => Key(c.ToString(), "text", c.ToString(), "number"))
            .ToArray());

        AddRow("QWERTYUIOP"
            .Select(c => Key(c.ToString(), "text", char.ToLowerInvariant(c).ToString()))
            .ToArray());

        AddRow("ASDFGHJKLÇ"
            .Select(c => Key(c.ToString(), "text", char.ToLowerInvariant(c).ToString()))
            .ToArray());

        var third = "ZXCVBNM"
            .Select(c => Key(c.ToString(), "text", char.ToLowerInvariant(c).ToString()))
            .ToList();

        third.Add(Key(",", "text", ",", "number"));
        third.Add(Key(".", "text", ".", "number"));
        third.Add(Key("-", "text", "-", "number"));
        AddRow(third.ToArray());

        AddRow(new[]
        {
            kind == "email"
                ? Key("@", "text", "@", "number", 1.0)
                : Key("/", "text", "/", "number", 1.0),
            Key("ESPAÇO", "text", " ", "normal", 4.8),
            Key("APAGAR", "backspace", "", "danger", 1.8),
            Key("OK", "enter", "", "primary", 1.7),
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
                Width = new GridLength(key.Weight, GridUnitType.Star),
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
            _ => "TouchKeyStyle",
        };

        return (Style)Application.Current.FindResource(key);
    }

    private void KeyButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: KeySpec spec })
        {
            KeyRequested?.Invoke(
                this,
                new VirtualKeyEventArgs(spec.Action, spec.Text));
        }
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e)
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
    public VirtualKeyEventArgs(string action, string text)
    {
        Action = action;
        Text = text;
    }

    public string Action { get; }
    public string Text { get; }
}
