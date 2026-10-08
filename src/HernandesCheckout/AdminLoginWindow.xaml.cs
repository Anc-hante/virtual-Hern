using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Input;

namespace HernandesCheckout;

public partial class AdminLoginWindow : Window
{
    private enum AdminField
    {
        Username,
        Password,
    }

    private const string AdminUser = "admin";
    private const string AdminPasswordSha256 =
        "5a48efcab4528e9926bac957299787cb3b7a7ce95786a11992f9b5aa4a35e987";

    private AdminField _activeField =
        AdminField.Username;

    public AdminLoginWindow()
    {
        InitializeComponent();

        AdminKeyboard.KeyRequested +=
            AdminKeyboard_KeyRequested;

        AdminKeyboard.HideRequested +=
            AdminKeyboard_HideRequested;

        Loaded += (_, _) =>
        {
            AdminKeyboard.SetKind("text");
            UsernameBox.Focus();
        };
    }

    private void LoginButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        TryAuthenticate();
    }

    private void UsernameBox_GotFocus(
        object sender,
        RoutedEventArgs e)
    {
        _activeField =
            AdminField.Username;

        AdminKeyboard.Visibility =
            Visibility.Visible;

        AdminKeyboard.SetKind("text");
    }

    private void PasswordInput_GotFocus(
        object sender,
        RoutedEventArgs e)
    {
        _activeField =
            AdminField.Password;

        AdminKeyboard.Visibility =
            Visibility.Visible;

        AdminKeyboard.SetKind("text");
    }

    private void AdminKeyboard_KeyRequested(
        object? sender,
        VirtualKeyEventArgs e)
    {
        if (e.Action == "enter")
        {
            if (_activeField == AdminField.Username)
            {
                PasswordInput.Focus();
            }
            else
            {
                TryAuthenticate();
            }

            return;
        }

        if (_activeField == AdminField.Username)
        {
            if (e.Action == "backspace")
            {
                if (UsernameBox.Text.Length > 0)
                {
                    UsernameBox.Text =
                        UsernameBox.Text[..^1];

                    UsernameBox.CaretIndex =
                        UsernameBox.Text.Length;
                }

                return;
            }

            if (e.Action == "text")
            {
                UsernameBox.Text += e.Text;
                UsernameBox.CaretIndex =
                    UsernameBox.Text.Length;
            }

            return;
        }

        if (e.Action == "backspace")
        {
            if (PasswordInput.Password.Length > 0)
            {
                PasswordInput.Password =
                    PasswordInput.Password[..^1];
            }

            return;
        }

        if (e.Action == "text")
        {
            PasswordInput.Password +=
                e.Text;
        }
    }

    private void AdminKeyboard_HideRequested(
        object? sender,
        EventArgs e)
    {
        AdminKeyboard.Visibility =
            Visibility.Collapsed;
    }

    private void PasswordInput_KeyDown(
        object sender,
        KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            TryAuthenticate();
            e.Handled = true;
        }
    }

    private void TryAuthenticate()
    {
        var username =
            UsernameBox.Text.Trim();

        var password =
            PasswordInput.Password;

        var hash =
            Convert.ToHexString(
                    SHA256.HashData(
                        Encoding.UTF8.GetBytes(password)))
                .ToLowerInvariant();

        if (
            string.Equals(
                username,
                AdminUser,
                StringComparison.OrdinalIgnoreCase)
            &&
            CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(hash),
                Encoding.ASCII.GetBytes(
                    AdminPasswordSha256))
        )
        {
            ErrorText.Text = string.Empty;
            DialogResult = true;
            Close();
            return;
        }

        ErrorText.Text =
            "Usuário ou senha inválidos.";

        PasswordInput.Clear();
        PasswordInput.Focus();
    }

    private void CancelButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
