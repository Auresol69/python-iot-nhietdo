using System;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MQTTnet;
using MQTTnet.Client;
using Backend.Data;

namespace Backend.Services
{
    public class MqttBackgroundService : BackgroundService
    {
        private readonly ILogger<MqttBackgroundService> _logger;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IConfiguration _configuration;
        private readonly IMqttClient _mqttClient;
        private readonly MqttClientOptions _mqttClientOptions;
        private readonly MqttFactory _mqttFactory;

        public MqttBackgroundService(
            ILogger<MqttBackgroundService> logger,
            IServiceScopeFactory scopeFactory,
            IConfiguration configuration)
        {
            _logger = logger;
            _scopeFactory = scopeFactory;
            _configuration = configuration;

            _mqttFactory = new MqttFactory();
            _mqttClient = _mqttFactory.CreateMqttClient();

            // Read settings from configuration
            var brokerHost = _configuration.GetConnectionString("Mosquitto") ?? "localhost";
            var brokerPort = _configuration.GetValue<int>("MqttConfig:Port", 1883);
            var clientId = _configuration.GetValue<string>("MqttConfig:ClientId") ?? $"Backend_Subscriber_{Guid.NewGuid()}";

            _mqttClientOptions = new MqttClientOptionsBuilder()
                .WithTcpServer(brokerHost, brokerPort)
                .WithClientId(clientId)
                .WithCleanSession()
                .Build();

            // Set up message handler
            _mqttClient.ApplicationMessageReceivedAsync += HandleMessageReceivedAsync;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (!_mqttClient.IsConnected)
                    {
                        var host = _configuration.GetConnectionString("Mosquitto") ?? "localhost";
                        var port = _configuration.GetValue<int>("MqttConfig:Port", 1883);
                        _logger.LogInformation("Connecting to MQTT broker at {Host}:{Port}...", host, port);

                        var result = await _mqttClient.ConnectAsync(_mqttClientOptions, stoppingToken);
                        _logger.LogInformation("Connected successfully. Result: {ResultCode}", result.ResultCode);

                        // Subscribe to wildcard topic: iot/devices/+/metrics
                        var subscribeOptions = _mqttFactory.CreateSubscribeOptionsBuilder()
                            .WithTopicFilter(f => f.WithTopic("iot/devices/+/metrics"))
                            .Build();

                        await _mqttClient.SubscribeAsync(subscribeOptions, stoppingToken);
                        _logger.LogInformation("Subscribed to wildcard topic: iot/devices/+/metrics");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to connect to MQTT broker. Retrying in 5 seconds...");
                }

                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
            }
        }

        private async Task HandleMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
        {
            var topic = args.ApplicationMessage.Topic;
            
            byte[] payloadBytes = args.ApplicationMessage.PayloadSegment.ToArray();
            var payloadString = Encoding.UTF8.GetString(payloadBytes);

            _logger.LogInformation("Received MQTT message on topic: {Topic}. Payload: {Payload}", topic, payloadString);

            // Parse Topic: iot/devices/{deviceCode}/metrics
            var topicParts = topic.Split('/');
            if (topicParts.Length != 4 || 
                !string.Equals(topicParts[0], "iot", StringComparison.OrdinalIgnoreCase) || 
                !string.Equals(topicParts[1], "devices", StringComparison.OrdinalIgnoreCase) || 
                !string.Equals(topicParts[3], "metrics", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Skipping message. Topic format is invalid: {Topic}", topic);
                return;
            }

            var deviceCode = topicParts[2];
            if (string.IsNullOrWhiteSpace(deviceCode))
            {
                _logger.LogWarning("Skipping message. DeviceCode is empty in topic: {Topic}", topic);
                return;
            }

            // Parse JSON Payload
            MqttMetricPayload? payload;
            try
            {
                var options = new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                };
                payload = JsonSerializer.Deserialize<MqttMetricPayload>(payloadString, options);
            }
            catch (JsonException ex)
            {
                _logger.LogError(ex, "Failed to deserialize JSON payload: {Payload}", payloadString);
                return;
            }

            if (payload == null)
            {
                _logger.LogWarning("Decoded payload is null. Topic: {Topic}", topic);
                return;
            }

            // Save to Database via scoped AppDbContext
            using (var scope = _scopeFactory.CreateScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                try
                {
                    // Find existing device by DeviceCode
                    var device = await dbContext.Devices
                        .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

                    if (device == null)
                    {
                        _logger.LogInformation("DeviceCode {DeviceCode} not found in database. Auto-creating device...", deviceCode);
                        device = new Device
                        {
                            Id = Guid.NewGuid(),
                            DeviceCode = deviceCode,
                            Name = $"Auto Created {deviceCode}",
                            IsVirtual = false,
                            IsOnline = true,
                            CreatedAt = DateTime.UtcNow
                        };

                        dbContext.Devices.Add(device);
                        try
                        {
                            await dbContext.SaveChangesAsync();
                        }
                        catch (DbUpdateException)
                        {
                            // In case of parallel inserts causing duplicate key on unique index, re-fetch the device
                            dbContext.Entry(device).State = EntityState.Detached;
                            device = await dbContext.Devices
                                .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

                            if (device == null)
                            {
                                throw; // Re-throw if it's still missing and it wasn't a duplicate key
                            }
                        }
                    }

                    // Add new metric record
                    var metric = new SensorMetric
                    {
                        DeviceId = device.Id,
                        Temperature = payload.Temperature,
                        Humidity = payload.Humidity,
                        Timestamp = payload.Timestamp ?? DateTime.UtcNow
                    };

                    dbContext.SensorMetrics.Add(metric);
                    await dbContext.SaveChangesAsync();

                    _logger.LogInformation("Successfully saved metric for device {DeviceCode}: Temp={Temp}, Humid={Humid}", 
                        deviceCode, metric.Temperature, metric.Humidity);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error saving sensor metrics to database for device {DeviceCode}", deviceCode);
                }
            }
        }

        public override async Task StopAsync(CancellationToken cancellationToken)
        {
            _logger.LogInformation("Stopping MQTT Background Service...");
            
            if (_mqttClient != null)
            {
                try
                {
                    await _mqttClient.DisconnectAsync(cancellationToken: cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error during MQTT client disconnection.");
                }
                finally
                {
                    _mqttClient.Dispose();
                }
            }

            await base.StopAsync(cancellationToken);
        }
    }

    public class MqttMetricPayload
    {
        public double Temperature { get; set; }
        public double Humidity { get; set; }
        public DateTime? Timestamp { get; set; }
    }
}
