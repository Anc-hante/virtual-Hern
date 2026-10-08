namespace HernandesCheckout;

public sealed class PrinterWorker : IAsyncDisposable
{
    private readonly TotemApiClient _api;
    private readonly CancellationTokenSource _cts = new();
    private Task? _loopTask;

    public PrinterWorker(TotemApiClient api)
    {
        _api = api;
    }

    public void Start()
    {
        if (_loopTask is not null)
        {
            return;
        }

        _loopTask = Task.Run(
            () => RunAsync(_cts.Token));
    }

    private async Task RunAsync(
        CancellationToken cancellationToken)
    {
        using var timer =
            new PeriodicTimer(
                TimeSpan.FromSeconds(2));

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await ProcessOneAsync();

                await timer.WaitForNextTickAsync(
                    cancellationToken);
            }
            catch (OperationCanceledException)
                when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                try
                {
                    await Task.Delay(
                        TimeSpan.FromSeconds(5),
                        cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private async Task ProcessOneAsync()
    {
        if (!ReceiptPrinter.IsAvailable())
        {
            return;
        }

        // Flush the completed-order event first so the server can create
        // its print job before we ask for the next receipt.
        await _api.FlushPendingAsync();

        var job =
            await _api.ClaimPrintJobAsync();

        if (job is null)
        {
            return;
        }

        try
        {
            var printerName =
                ReceiptPrinter.Print(
                    job.ReceiptText);

            await _api.CompletePrintJobAsync(
                job.JobId,
                success: true,
                error: string.Empty);
        }
        catch (Exception ex)
        {
            await _api.CompletePrintJobAsync(
                job.JobId,
                success: false,
                error: ex.Message);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();

        if (_loopTask is not null)
        {
            try
            {
                await _loopTask;
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown.
            }
        }

        _cts.Dispose();
    }
}
