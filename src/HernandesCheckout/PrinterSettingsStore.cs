using System.IO;
using System.Text.Json;

namespace HernandesCheckout;

public static class PrinterSettingsStore
{
    private sealed class PrinterSettings
    {
        public string PrinterName { get; set; } = string.Empty;
    }

    private static readonly object Sync = new();

    private static string FolderPath =>
        Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData),
            "GrupoHernandes",
            "VirtualHern");

    private static string FilePath =>
        Path.Combine(
            FolderPath,
            "printer-settings.json");

    public static string GetPrinterName()
    {
        lock (Sync)
        {
            try
            {
                if (!File.Exists(FilePath))
                {
                    return string.Empty;
                }

                var json =
                    File.ReadAllText(FilePath);

                var settings =
                    JsonSerializer.Deserialize<PrinterSettings>(
                        json);

                return settings?.PrinterName?.Trim()
                    ?? string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }
    }

    public static void SavePrinterName(
        string printerName)
    {
        var value =
            (printerName ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException(
                "Selecione uma impressora válida.",
                nameof(printerName));
        }

        lock (Sync)
        {
            Directory.CreateDirectory(FolderPath);

            var json =
                JsonSerializer.Serialize(
                    new PrinterSettings
                    {
                        PrinterName = value,
                    },
                    new JsonSerializerOptions
                    {
                        WriteIndented = true,
                    });

            File.WriteAllText(
                FilePath,
                json);
        }
    }
}
