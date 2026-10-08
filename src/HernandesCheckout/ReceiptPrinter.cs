using System.Printing;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace HernandesCheckout;

public static class ReceiptPrinter
{
    public static IReadOnlyList<string> GetInstalledPrinters()
    {
        using var server = new LocalPrintServer();

        return server
            .GetPrintQueues()
            .Select(queue => queue.FullName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static string GetConfiguredPrinterName()
    {
        var saved =
            PrinterSettingsStore
                .GetPrinterName();

        if (!string.IsNullOrWhiteSpace(saved))
        {
            return saved;
        }

        return Environment
            .GetEnvironmentVariable(
                "HERNANDES_TOTEM_PRINTER_NAME")
            ?.Trim()
            ?? string.Empty;
    }

    public static bool IsAvailable()
    {
        try
        {
            using var server = new LocalPrintServer();
            return ResolveQueue(server) is not null;
        }
        catch
        {
            return false;
        }
    }

    public static string Print(
        string receiptText,
        string? printerName = null)
    {
        using var server = new LocalPrintServer();

        var queue = ResolveQueue(
                server,
                printerName)
            ?? throw new InvalidOperationException(
                "Nenhuma impressora configurada no Windows.");

        var document = new FlowDocument
        {
            PageWidth = 302,
            PagePadding = new Thickness(10, 8, 10, 12),
            ColumnWidth = double.PositiveInfinity,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11,
            Foreground = Brushes.Black,
            Background = Brushes.White,
        };

        document.Blocks.Add(
            new Paragraph(
                new Run(receiptText ?? string.Empty))
            {
                Margin = new Thickness(0),
                LineHeight = 15,
            });

        var paginator =
            ((IDocumentPaginatorSource)document)
            .DocumentPaginator;

        var lineCount =
            Math.Max(
                1,
                (receiptText ?? string.Empty)
                    .Split('\n')
                    .Length);

        paginator.PageSize =
            new Size(
                302,
                Math.Max(
                    520,
                    lineCount * 18 + 120));

        var writer =
            PrintQueue.CreateXpsDocumentWriter(queue);

        writer.Write(paginator);

        return queue.FullName;
    }

    public static string PrintTest(
        string printerName)
    {
        var lines = new[]
        {
            "HERNANDES ATACADO E DISTRIBUICAO",
            "TESTE DE IMPRESSAO - TOTEM",
            "------------------------------------------",
            $"Impressora: {printerName}",
            $"Data: {DateTime.Now:dd/MM/yyyy HH:mm:ss}",
            "",
            "Se voce esta lendo este cupom,",
            "a impressora foi configurada corretamente.",
            "",
            "------------------------------------------",
            "Hernandes Checkout",
            "",
            "",
            "",
        };

        return Print(
            string.Join(
                Environment.NewLine,
                lines),
            printerName);
    }

    private static PrintQueue? ResolveQueue(
        LocalPrintServer server,
        string? preferredPrinter = null)
    {
        var configuredPrinter =
            (preferredPrinter ?? string.Empty)
                .Trim();

        if (string.IsNullOrWhiteSpace(configuredPrinter))
        {
            configuredPrinter =
                GetConfiguredPrinterName();
        }

        if (!string.IsNullOrWhiteSpace(configuredPrinter))
        {
            try
            {
                return server.GetPrintQueue(
                    configuredPrinter);
            }
            catch
            {
                // A saved printer can have been removed or renamed.
                // Fall back to the Windows default queue.
            }
        }

        try
        {
            return server.DefaultPrintQueue;
        }
        catch
        {
            return null;
        }
    }
}
