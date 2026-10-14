# Windows PowerShell 5.1 native GDI printing for an installed Windows printer.
# JSON payload is received on stdin; no receipt data is interpolated in code.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
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

    $document = New-Object System.Drawing.Printing.PrintDocument
    $font = $null

    try {
        $document.DocumentName = 'Hernandes Checkout - Cupom'
        $document.PrintController =
            New-Object System.Drawing.Printing.StandardPrintController
        $document.PrinterSettings.PrinterName = $name

        if (-not $document.PrinterSettings.IsValid) {
            throw ('Impressora nao disponivel no Windows: ' + $name)
        }

        $document.DefaultPageSettings.Landscape = $false
        $document.DefaultPageSettings.Margins =
            New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
        $document.OriginAtMargins = $false

        # GDI PaperSize dimensions are in hundredths of an inch.
        # ELGIN i8 thermal rolls are normally 80mm. Do not use an A4
        # printer page, as that feeds excessive blank receipt paper.
        $lines = @($text -split '?
').Count
        $height = [int][Math]::Min(3200, [Math]::Max(360, ($lines + 5) * 19))
        $paper = New-Object System.Drawing.Printing.PaperSize(
            'Hernandes - Bobina 80mm', 315, $height)
        $document.DefaultPageSettings.PaperSize = $paper

        $font = New-Object System.Drawing.Font(
            'Consolas', 8.5,
            [System.Drawing.FontStyle]::Regular,
            [System.Drawing.GraphicsUnit]::Point)

        $script:receiptText = $text
        $script:receiptFont = $font
        $script:receiptHeight = $height

        $handler = [System.Drawing.Printing.PrintPageEventHandler] {
            param($sender, $eventArgs)

            $eventArgs.Graphics.PageUnit =
                [System.Drawing.GraphicsUnit]::Display
            $bounds = New-Object System.Drawing.RectangleF(
                [single]8, [single]8,
                [single]294, [single]($script:receiptHeight - 16))
            $format = New-Object System.Drawing.StringFormat
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
        if ($font -ne $null) { $font.Dispose() }
        $document.Dispose()
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
