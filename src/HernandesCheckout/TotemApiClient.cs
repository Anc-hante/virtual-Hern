using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace HernandesCheckout;

public sealed class TotemApiClient
{
    private const string DefaultApiUrl =
        "https://hernandesvpn.dyndns.org/api/ecommerce/totem/events";

    private readonly HttpClient _httpClient;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly string _apiUrl;
    private readonly string _token;
    private readonly string _dataFolder;
    private readonly string _queueFile;

    public TotemApiClient()
    {
        _apiUrl =
            Environment.GetEnvironmentVariable(
                "HERNANDES_TOTEM_API_URL")
            ?.Trim()
            ?? DefaultApiUrl;

        _token =
            Environment.GetEnvironmentVariable(
                "HERNANDES_TOTEM_API_TOKEN")
            ?.Trim()
            ?? string.Empty;

        _dataFolder = Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData),
            "GrupoHernandes",
            "VirtualHern");

        Directory.CreateDirectory(_dataFolder);

        _queueFile = Path.Combine(
            _dataFolder,
            "totem-events-pending.jsonl");

        DeviceId = LoadOrCreateDeviceId();

        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(8),
        };

        _httpClient.DefaultRequestHeaders.Accept.ParseAdd(
            "application/json");

        if (!string.IsNullOrWhiteSpace(_token))
        {
            _httpClient.DefaultRequestHeaders.TryAddWithoutValidation(
                "X-Totem-Token",
                _token);
        }
    }

    public string DeviceId { get; }

    public async Task SendSimpleEventAsync(
        string eventType,
        string sessionId,
        Dictionary<string, object?>? data = null)
    {
        var envelope = BaseEnvelope(
            eventType,
            sessionId);

        if (data is not null)
        {
            foreach (var item in data)
            {
                envelope[item.Key] = item.Value;
            }
        }

        await SendOrQueueAsync(envelope);
    }

    public async Task SendWebEventAsync(
        JsonElement message,
        string sessionId)
    {
        if (!message.TryGetProperty(
                "event_type",
                out var eventTypeElement))
        {
            return;
        }

        var eventType =
            eventTypeElement.GetString()?.Trim();

        if (string.IsNullOrWhiteSpace(eventType))
        {
            return;
        }

        var envelope = BaseEnvelope(
            eventType,
            sessionId);

        foreach (var property in message.EnumerateObject())
        {
            if (property.NameEquals("type") ||
                property.NameEquals("event_type"))
            {
                continue;
            }

            envelope[property.Name] =
                JsonElementToObject(property.Value);
        }

        await SendOrQueueAsync(envelope);
    }

    public async Task FlushPendingAsync()
    {
        await _sendLock.WaitAsync();

        try
        {
            await FlushPendingCoreAsync();
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private Dictionary<string, object?> BaseEnvelope(
        string eventType,
        string sessionId)
    {
        return new Dictionary<string, object?>
        {
            ["event_id"] = Guid.NewGuid().ToString(),
            ["device_id"] = DeviceId,
            ["session_id"] = sessionId,
            ["event_type"] = eventType,
            ["occurred_at"] =
                DateTimeOffset.Now.ToString("O"),
        };
    }

    private async Task SendOrQueueAsync(
        Dictionary<string, object?> envelope)
    {
        await _sendLock.WaitAsync();

        try
        {
            await FlushPendingCoreAsync();

            var json =
                JsonSerializer.Serialize(envelope);

            var sent =
                await TrySendJsonAsync(json);

            if (!sent)
            {
                await AppendQueueAsync(json);
            }
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private async Task FlushPendingCoreAsync()
    {
        if (!File.Exists(_queueFile))
        {
            return;
        }

        string[] lines;

        try
        {
            lines = await File.ReadAllLinesAsync(
                _queueFile);
        }
        catch
        {
            return;
        }

        var pending = new List<string>();

        foreach (var raw in lines)
        {
            var line = raw.Trim();

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (pending.Count > 0)
            {
                pending.Add(line);
                continue;
            }

            var sent =
                await TrySendJsonAsync(line);

            if (!sent)
            {
                pending.Add(line);
            }
        }

        try
        {
            if (pending.Count == 0)
            {
                File.Delete(_queueFile);
            }
            else
            {
                await File.WriteAllLinesAsync(
                    _queueFile,
                    pending);
            }
        }
        catch
        {
            // Queue persistence must never interrupt checkout.
        }
    }

    private async Task<bool> TrySendJsonAsync(
        string json)
    {
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                _apiUrl);

            request.Content = new StringContent(
                json,
                Encoding.UTF8,
                "application/json");

            using var response =
                await _httpClient.SendAsync(request);

            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private async Task AppendQueueAsync(
        string json)
    {
        try
        {
            await File.AppendAllTextAsync(
                _queueFile,
                json + Environment.NewLine,
                Encoding.UTF8);
        }
        catch
        {
            // Checkout must continue even if local queue cannot be written.
        }
    }

    private string LoadOrCreateDeviceId()
    {
        var filePath = Path.Combine(
            _dataFolder,
            "totem-device-id.txt");

        try
        {
            if (File.Exists(filePath))
            {
                var stored =
                    File.ReadAllText(filePath).Trim();

                if (!string.IsNullOrWhiteSpace(stored))
                {
                    return stored;
                }
            }

            var machine =
                Environment.MachineName
                    .Trim()
                    .ToUpperInvariant();

            var generated =
                "TOTEM-" +
                (string.IsNullOrWhiteSpace(machine)
                    ? "HERNANDES"
                    : machine) +
                "-" +
                Guid.NewGuid()
                    .ToString("N")[..6]
                    .ToUpperInvariant();

            File.WriteAllText(
                filePath,
                generated,
                Encoding.UTF8);

            return generated;
        }
        catch
        {
            return "TOTEM-" +
                Environment.MachineName
                    .Trim()
                    .ToUpperInvariant();
        }
    }

    private static object? JsonElementToObject(
        JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String =>
                element.GetString(),

            JsonValueKind.Number =>
                element.TryGetInt64(out var integer)
                    ? integer
                    : element.GetDouble(),

            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,

            JsonValueKind.Array =>
                element.EnumerateArray()
                    .Select(JsonElementToObject)
                    .ToList(),

            JsonValueKind.Object =>
                element.EnumerateObject()
                    .ToDictionary(
                        property => property.Name,
                        property => JsonElementToObject(
                            property.Value)),

            _ => element.ToString(),
        };
    }
}
