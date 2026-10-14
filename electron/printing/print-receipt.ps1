# Windows PowerShell 5.1 native printing, using the installed ELGIN i8 driver.
# Receipt and printer name are JSON from stdin, never inserted into a command.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing

try {
    $raw = [Console]::In.ReadToEnd()
    $payload = ConvertFrom-Json -InputObject $raw
    $name = [string]$payload.printerName
    $text = [string]$payload.text

    if ([string]::IsNullOrWhiteSpace($name) -or
        [string]::IsNullOrWhiteSpace($text)) {
        throw 'Impressora ou cupom vazio.'
    }

    $document = [System.Drawing.Printing.PrintDocument]::new()
    $font = $null

    try {
        $document.DocumentName = 'Hernandes Checkout - Cupom'
        $document.PrintController =
            [System.Drawing.Printing.StandardPrintController]::new()
        $document.PrinterSettings.PrinterName = $name

        if (-not $document.PrinterSettings.IsValid) {
            throw ('Impressora nao disponivel no Windows: ' + $name)
        }

        $document.DefaultPageSettings.Landscape = $false
        $document.DefaultPageSettings.Margins =
            [System.Drawing.Printing.Margins]::new(0, 0, 0, 0)
        $document.OriginAtMargins = $false

        # PaperSize uses hundredths of an inch: 315 = 80mm roll.
        $lines = @($text -split '\r?\n').Count
        $height = [int][Math]::Min(3200, [Math]::Max(360, ($lines + 5) * 19))
        $paper = [System.Drawing.Printing.PaperSize]::new(
            'Hernandes - Bobina 80mm', 315, $height)
        $document.DefaultPageSettings.PaperSize = $paper

        $font = [System.Drawing.Font]::new(
            'Consolas', [single]8,
            [System.Drawing.FontStyle]::Regular,
            [System.Drawing.GraphicsUnit]::Point)

        $script:receiptText = $text
        $script:receiptFont = $font
        $script:receiptHeight = $height

        $handler = [System.Drawing.Printing.PrintPageEventHandler] {
            param($sender, $eventArgs)

            $eventArgs.Graphics.PageUnit =
                [System.Drawing.GraphicsUnit]::Inch
            $bounds = [System.Drawing.RectangleF]::new(
                [single]0.08, [single]0.08,
                [single]2.98, [single](($script:receiptHeight / 100) - 0.16))
            $format = [System.Drawing.StringFormat]::new()
            try {
                $eventArgs.Graphics.DrawString(
                    $script:receiptText,
                    $script:receiptFont,
                    [System.Drawing.Brushes]::Black,
                    $bounds,
                    $format)
            } finally {
                $format.Dispose()
            }
            $eventArgs.HasMorePages = $false
        }

        $document.add_PrintPage($handler)
        $document.Print()
        [Console]::Out.WriteLine('PRINT_SUBMITTED')
    } finally {
        if ($null -ne $font) { $font.Dispose() }
        $document.Dispose()
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
