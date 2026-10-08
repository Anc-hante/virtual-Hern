using System.Windows;
using System.Windows.Controls;

namespace HernandesCheckout;

public partial class PrinterSettingsWindow : Window
{
    public PrinterSettingsWindow()
    {
        InitializeComponent();

        Loaded += (_, _) =>
        {
            LoadPrinters();
        };
    }

    public string SavedPrinterName { get; private set; } =
        string.Empty;

    private void LoadPrinters()
    {
        StatusText.Text =
            "Procurando impressoras instaladas no Windows...";

        PrintersList.Items.Clear();

        try
        {
            var printers =
                ReceiptPrinter
                    .GetInstalledPrinters();

            var current =
                PrinterSettingsStore
                    .GetPrinterName();

            CurrentPrinterText.Text =
                string.IsNullOrWhiteSpace(current)
                    ? "Nenhuma impressora configurada"
                    : current;

            foreach (var printer in printers)
            {
                PrintersList.Items.Add(printer);
            }

            if (printers.Count == 0)
            {
                StatusText.Text =
                    "Nenhuma impressora foi encontrada. Verifique se ela está instalada no Windows.";
                return;
            }

            if (!string.IsNullOrWhiteSpace(current))
            {
                var match =
                    printers.FirstOrDefault(
                        printer =>
                            string.Equals(
                                printer,
                                current,
                                StringComparison.OrdinalIgnoreCase));

                if (match is not null)
                {
                    PrintersList.SelectedItem =
                        match;
                }
            }

            if (PrintersList.SelectedItem is null)
            {
                PrintersList.SelectedIndex = 0;
            }

            StatusText.Text =
                $"{printers.Count} impressora(s) encontrada(s).";
        }
        catch (Exception ex)
        {
            StatusText.Text =
                "Não foi possível listar as impressoras: " +
                ex.Message;
        }

        UpdateButtons();
    }

    private void PrintersList_SelectionChanged(
        object sender,
        SelectionChangedEventArgs e)
    {
        UpdateButtons();
    }

    private void UpdateButtons()
    {
        var selected =
            PrintersList.SelectedItem
                as string;

        var enabled =
            !string.IsNullOrWhiteSpace(selected);

        TestButton.IsEnabled = enabled;
        SaveButton.IsEnabled = enabled;
    }

    private void RefreshPrintersButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        LoadPrinters();
    }

    private void TestButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        var selected =
            PrintersList.SelectedItem
                as string;

        if (string.IsNullOrWhiteSpace(selected))
        {
            return;
        }

        TestButton.IsEnabled = false;
        SaveButton.IsEnabled = false;

        try
        {
            StatusText.Text =
                "Enviando teste para a impressora...";

            var printer =
                ReceiptPrinter
                    .PrintTest(selected);

            StatusText.Text =
                "Teste enviado com sucesso para: " +
                printer;
        }
        catch (Exception ex)
        {
            StatusText.Text =
                "Falha no teste de impressão: " +
                ex.Message;
        }
        finally
        {
            UpdateButtons();
        }
    }

    private void SaveButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        var selected =
            PrintersList.SelectedItem
                as string;

        if (string.IsNullOrWhiteSpace(selected))
        {
            return;
        }

        try
        {
            PrinterSettingsStore
                .SavePrinterName(selected);

            SavedPrinterName =
                selected;

            CurrentPrinterText.Text =
                selected;

            StatusText.Text =
                "Impressora salva. Os próximos cupons serão enviados para ela.";

            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            StatusText.Text =
                "Não foi possível salvar a impressora: " +
                ex.Message;
        }
    }

    private void CloseButton_Click(
        object sender,
        RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
