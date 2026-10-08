using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Input;

namespace HernandesCheckout;

public partial class AdminLoginWindow : Window
{
    private const string AdminUser = "admin";
    private const string AdminPasswordSha256 =
        "5a48efcab4528e9926bac957299787cb3b7a7ce95786a11992f9b5aa4a35e987";

    public AdminLoginWindow()
    {
        InitializeComponent();

        Loaded += (_, _) =>
        {
            UsernameBox.Focus();
        };
    }

    private void LoginButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        TryAuthenticate();
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
