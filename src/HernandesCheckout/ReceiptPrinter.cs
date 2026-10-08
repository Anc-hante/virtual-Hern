using System.Printing;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace HernandesCheckout;

public static class ReceiptPrinter
{
    public static string Print(string receiptText)
    {
        using var server = new LocalPrintServer();
        var queue = server.DefaultPrintQueue
            ?? throw new InvalidOperationException(
                "Nenhuma impressora padrao configurada no Windows.");

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

        paginator.PageSize =
            new Size(302, 1120);

        var writer =
            PrintQueue.CreateXpsDocumentWriter(queue);

        writer.Write(paginator);

        return queue.FullName;
    }
}
