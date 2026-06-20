using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace Backend.Services
{
    /// <summary>
    /// Sends rich anomaly alert notifications to a Discord channel via Webhook.
    /// Registered as a Singleton - safe because HttpClient is managed by IHttpClientFactory.
    /// </summary>
    public class DiscordAlertService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<DiscordAlertService> _logger;

        public DiscordAlertService(
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<DiscordAlertService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        /// <summary>
        /// Sends a rich embed anomaly alert to the configured Discord webhook.
        /// This method is fully non-blocking and swallows exceptions so it
        /// never disrupts the MQTT processing pipeline.
        /// </summary>
        public async Task SendAnomalyAlertAsync(string deviceCode, double temperature, double zScore)
        {
            var webhookUrl = _configuration["DiscordConfig:WebhookUrl"];

            if (string.IsNullOrWhiteSpace(webhookUrl) || webhookUrl.Contains("YOUR_WEBHOOK"))
            {
                _logger.LogWarning("Discord WebhookUrl is not configured. Skipping Discord notification.");
                return;
            }

            try
            {
                // Use a 5-second timeout so Discord failures never stall the MQTT loop
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                using var httpClient = _httpClientFactory.CreateClient("Discord");

                var timestamp = DateTime.UtcNow.ToString("o");

                // Build a rich Discord embed payload
                var payload = new
                {
                    username = "IoT Sentinel",
                    avatar_url = "https://i.imgur.com/wSTFkRM.png",
                    embeds = new[]
                    {
                        new
                        {
                            title = "⚠️ Temperature Anomaly Detected",
                            description = $"Device **`{deviceCode}`** reported an unusual temperature spike that exceeds the statistical threshold.",
                            color = 15548997, // Discord red color
                            fields = new[]
                            {
                                new { name = "🌡️ Temperature", value = $"`{temperature:F2} °C`", inline = true },
                                new { name = "📊 Z-Score", value = $"`{zScore:F4}` *(threshold: 3.0)*", inline = true },
                                new { name = "🔌 Device", value = $"`{deviceCode}`", inline = false }
                            },
                            footer = new { text = "IoT Anomaly Detection System • Z-Score Algorithm" },
                            timestamp
                        }
                    }
                };

                var jsonContent = JsonSerializer.Serialize(payload);
                var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

                var response = await httpClient.PostAsync(webhookUrl, content, cts.Token);

                if (response.IsSuccessStatusCode)
                {
                    _logger.LogInformation("Discord anomaly alert sent successfully for device {DeviceCode}.", deviceCode);
                }
                else
                {
                    var responseBody = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("Discord webhook returned non-success status {StatusCode}: {Body}", response.StatusCode, responseBody);
                }
            }
            catch (TaskCanceledException)
            {
                _logger.LogWarning("Discord webhook request timed out for device {DeviceCode}.", deviceCode);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error sending Discord alert for device {DeviceCode}.", deviceCode);
            }
        }
    }
}
