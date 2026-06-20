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
using Microsoft.AspNetCore.SignalR;
using Backend.Hubs;
using Microsoft.Extensions.Caching.Distributed;

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
        private readonly IHubContext<SensorHub> _hubContext;
        private readonly IDistributedCache _cache;

        public MqttBackgroundService(
            ILogger<MqttBackgroundService> logger,
            IServiceScopeFactory scopeFactory,
            IConfiguration configuration,
            IHubContext<SensorHub> hubContext,
            IDistributedCache cache)
        {
            _logger = logger;
            _scopeFactory = scopeFactory;
            _configuration = configuration;
            _hubContext = hubContext;
            _cache = cache;

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

            // Set up message handlers
            _mqttClient.ApplicationMessageReceivedAsync += HandleMessageReceivedAsync;
            _mqttClient.ConnectedAsync += HandleConnectedAsync;
            _mqttClient.DisconnectedAsync += HandleDisconnectedAsync;
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

                        // Subscribe to metric topics: iot/devices/+/metrics
                        var subscribeOptions = _mqttFactory.CreateSubscribeOptionsBuilder()
                            .WithTopicFilter(f => f.WithTopic("iot/devices/+/metrics"))
                            .WithTopicFilter(f => f.WithTopic("iot/devices/+/lwt"))  // LWT Topic
                            .Build();

                        await _mqttClient.SubscribeAsync(subscribeOptions, stoppingToken);
                        _logger.LogInformation("Subscribed to topics: iot/devices/+/metrics and iot/devices/+/lwt");
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

            // Parse Topic: iot/devices/{deviceCode}/{messageType}
            var topicParts = topic.Split('/');
            if (topicParts.Length != 4 ||
                !string.Equals(topicParts[0], "iot", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(topicParts[1], "devices", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Skipping message. Topic format is invalid: {Topic}", topic);
                return;
            }

            var deviceCode = topicParts[2];
            var messageType = topicParts[3];

            if (string.IsNullOrWhiteSpace(deviceCode))
            {
                _logger.LogWarning("Skipping message. DeviceCode is empty in topic: {Topic}", topic);
                return;
            }

            // Handle LWT (Last Will and Testament) messages
            if (string.Equals(messageType, "lwt", StringComparison.OrdinalIgnoreCase))
            {
                await HandleLwtMessageAsync(deviceCode);
                return;
            }

            // Handle Metrics messages
            if (!string.Equals(messageType, "metrics", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Skipping message. Unknown message type: {MessageType}", messageType);
                return;
            }

            // Parse JSON Payload for metrics
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
                            // Invalidate devices list cache since a new device is auto-created
                            await _cache.RemoveAsync("devices:list");
                        }
                        // Trong môi trường thực tế chạy đa luồng, 2 gói tin MQTT bay vào cùng 1 mili-giây
                        // có thể gây ra lỗi trùng khóa (Duplicate Key) do tính năng Auto-create 
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
                    else if (!device.IsOnline)
                    {
                        // Device came back online
                        device.IsOnline = true;
                        dbContext.Devices.Update(device);
                        await dbContext.SaveChangesAsync();
                        _logger.LogInformation("Device {DeviceCode} is now ONLINE", deviceCode);
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

                    // Update latest status in Redis
                    try
                    {
                        var latestStatus = new DeviceLatestStatus
                        {
                            Temperature = metric.Temperature,
                            Humidity = metric.Humidity,
                            Timestamp = metric.Timestamp,
                            IsOnline = device.IsOnline
                        };
                        var cacheOptions = new DistributedCacheEntryOptions
                        {
                            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5)
                        };
                        var serializedStatus = JsonSerializer.Serialize(latestStatus);
                        await _cache.SetStringAsync($"device:{deviceCode}:latest_status", serializedStatus, cacheOptions);
                        _logger.LogInformation("Successfully updated Redis cache for device {DeviceCode}: Temp={Temp}, Humid={Humid}", deviceCode, metric.Temperature, metric.Humidity);
                    }
                    catch (Exception cacheEx)
                    {
                        _logger.LogError(cacheEx, "Failed to update Redis cache for device {DeviceCode}", deviceCode);
                    }

                    // Đối tượng metric thuộc lớp SensorMetric (Entity Framework). 
                    // Lớp này có thuộc tính liên kết ngược tới Device (public virtual Device? Device).
                    //Lớp Device lại có danh sách liên kết tới toàn bộ SensorMetrics (public virtual ICollection<SensorMetric> SensorMetrics).
                    await _hubContext.Clients.All.SendAsync("ReceiveSensorUpdate", deviceCode, new 
                    { 
                        temperature = metric.Temperature, 
                        humidity = metric.Humidity, 
                        timestamp = metric.Timestamp 
                    });

                    _logger.LogInformation("Successfully saved metric for device {DeviceCode}: Temp={Temp}, Humid={Humid}",
                        deviceCode, metric.Temperature, metric.Humidity);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error saving sensor metrics to database for device {DeviceCode}", deviceCode);
                }
            }
        }

        private async Task HandleLwtMessageAsync(string deviceCode)
        {
            _logger.LogWarning("Received LWT message for device {DeviceCode}. Marking as OFFLINE...", deviceCode);

            using (var scope = _scopeFactory.CreateScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                try
                {
                    var device = await dbContext.Devices
                        .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

                    if (device != null && device.IsOnline)
                    {
                        device.IsOnline = false;
                        dbContext.Devices.Update(device);
                        await dbContext.SaveChangesAsync();
                        _logger.LogInformation("Device {DeviceCode} is now OFFLINE", deviceCode);

                        // Notify connected clients
                        await _hubContext.Clients.All.SendAsync("DeviceOffline", deviceCode);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error updating device status for LWT message: {DeviceCode}", deviceCode);
                }
            }
        }

        private async Task HandleConnectedAsync(MqttClientConnectedEventArgs args)
        {
            _logger.LogInformation("MQTT Client connected successfully.");
            return;
        }

        private async Task HandleDisconnectedAsync(MqttClientDisconnectedEventArgs args)
        {
            _logger.LogWarning("MQTT Client disconnected. Reason: {Reason}", args.Reason);
            return;
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

    public class DeviceLatestStatus
    {
        public double Temperature { get; set; }
        public double Humidity { get; set; }
        public DateTime Timestamp { get; set; }
        public bool IsOnline { get; set; }
    }
}
