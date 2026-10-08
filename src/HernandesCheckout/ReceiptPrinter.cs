using System.Printing;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace HernandesCheckout;

public static class ReceiptPrinter
{
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

    public static string Print(string receiptText)
    {
        using var server = new LocalPrintServer();

        var queue = ResolveQueue(server)
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

    private static PrintQueue? ResolveQueue(
        LocalPrintServer server)
    {
        var configuredPrinter =
            Environment.GetEnvironmentVariable(
                "HERNANDES_TOTEM_PRINTER_NAME")
            ?.Trim();

        if (!string.IsNullOrWhiteSpace(configuredPrinter))
        {
            try
            {
                return server.GetPrintQueue(
                    configuredPrinter);
            }
            catch
            {
                // Fall back to the Windows default printer.
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
