# ELGIN i8 / Windows GDI printing. Receives a JSON receipt and PNG QR code via stdin.
# Printer selection uses the already installed Windows driver.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing

$document = $null
$font = $null
$captionFont = $null
$bitmap = $null
$stream = $null

try {
    $payload = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
    $name = [string]$payload.printerName
    $text = [string]$payload.text
    $qrPngBase64 = [string]$payload.qrPngBase64

    if ([string]::IsNullOrWhiteSpace($name) -or
        [string]::IsNullOrWhiteSpace($text)) {
        throw 'Impressora ou cupom vazio.'
    }
    if ([string]::IsNullOrWhiteSpace($qrPngBase64)) {
        throw 'O QR Code de cadastro nao foi gerado.'
    }

    $bytes = [Convert]::FromBase64String($qrPngBase64)
    $stream = [System.IO.MemoryStream]::new($bytes, $false)
    $bitmap = [System.Drawing.Image]::FromStream($stream)

    $document = [System.Drawing.Printing.PrintDocument]::new()
    $document.DocumentName = 'Hernandes Checkout - Cupom Totem'
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

    # 315 hundredths of an inch = 80mm roll. Generate a longer receipt
    # for all order lines + an approximately 42mm QR Code at the bottom.
    $lines = @($text -split '\r?\n').Count
    $lineHeight = 0.20
    $qrSize = 1.65
    $qrTop = 0.10 + ($lines * $lineHeight) + 0.25
    $height = [int][Math]::Ceiling(($qrTop + $qrSize + 0.85) * 100)
    if ($height -gt 3200) {
        throw 'Cupom muito longo para o tamanho de papel configurado.'
    }
    $height = [int][Math]::Max(600, $height)

    $paper = [System.Drawing.Printing.PaperSize]::new(
        'Hernandes - Bobina 80mm', 315, $height)
    $document.DefaultPageSettings.PaperSize = $paper

    $font = [System.Drawing.Font]::new(
        'Consolas', [single]9.5,
        [System.Drawing.FontStyle]::Regular,
        [System.Drawing.GraphicsUnit]::Point)
    $captionFont = [System.Drawing.Font]::new(
        'Arial', [single]8,
        [System.Drawing.FontStyle]::Bold,
        [System.Drawing.GraphicsUnit]::Point)

    $script:receiptText = $text
    $script:receiptFont = $font
    $script:receiptCaption = $captionFont
    $script:receiptQR = $bitmap
    $script:receiptHeight = $height
    $script:receiptQrTop = $qrTop
    $script:receiptQrSize = $qrSize

    $handler = [System.Drawing.Printing.PrintPageEventHandler] {
        param($sender, $eventArgs)

        $eventArgs.Graphics.PageUnit =
            [System.Drawing.GraphicsUnit]::Inch
        $eventArgs.Graphics.TextRenderingHint =
            [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit

        # Print each line with a consistent baseline, so the QR position
        # exactly matches the space reserved in the custom paper length.
        $rows = @($script:receiptText -split '\r?\n')
        for ($index = 0; $index -lt $rows.Count; $index++) {
            $y = [single](0.10 + $index * 0.20)
            $eventArgs.Graphics.DrawString(
                [string]$rows[$index], $script:receiptFont,
                [System.Drawing.Brushes]::Black,
                [single]0.08, $y)
        }

        $qrX = [single]0.75
        $qrY = [single]$script:receiptQrTop
        $qrSize = [single]$script:receiptQrSize
        $eventArgs.Graphics.InterpolationMode =
            [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $eventArgs.Graphics.DrawImage(
            $script:receiptQR, $qrX, $qrY, $qrSize, $qrSize)

        $footer = 'CADASTRE-SE NO GRUPO HERNANDES'
        $eventArgs.Graphics.DrawString(
            $footer, $script:receiptCaption,
            [System.Drawing.Brushes]::Black,
            [single]0.25, [single]($qrY + $qrSize + 0.08))
        $eventArgs.Graphics.DrawString(
            'grupohernandes.com.br/cadastrar',
            $script:receiptCaption,
            [System.Drawing.Brushes]::Black,
            [single]0.16, [single]($qrY + $qrSize + 0.32))

        $eventArgs.HasMorePages = $false
    }

    $document.add_PrintPage($handler)
    $document.Print()
    # This reports a job accepted by the Windows spooler, not proof of
    # physical paper output. Do not confuse the two states.
    [Console]::Out.WriteLine('PRINT_SUBMITTED')
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $document) { $document.Dispose() }
    if ($null -ne $font) { $font.Dispose() }
    if ($null -ne $captionFont) { $captionFont.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
}
