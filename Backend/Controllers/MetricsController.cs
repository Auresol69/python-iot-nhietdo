using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Microsoft.Extensions.Caching.Distributed;
using System.Text.Json;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MetricsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IDistributedCache _cache;

        public MetricsController(AppDbContext context, IDistributedCache cache)
        {
            _context = context;
            _cache = cache;
        }

        /// <summary>
        /// Get all devices with their latest sensor metrics.
        /// </summary>
        /// <returns>List of all devices with basic info</returns>
        [HttpGet("devices")]
        public async Task<ActionResult<IEnumerable<DeviceDto>>> GetAllDevices()
        {
            const string cacheKey = "devices:list";

            try
            {
                var cachedData = await _cache.GetStringAsync(cacheKey);
                if (!string.IsNullOrEmpty(cachedData))
                {
                    var cachedDevices = JsonSerializer.Deserialize<List<DeviceDto>>(cachedData);
                    if (cachedDevices != null)
                    {
                        return Ok(cachedDevices);
                    }
                }
            }
            catch (Exception)
            {
                // Continue to database fetch as fallback
            }

            var devices = await _context.Devices
                .Select(d => new DeviceDto
                {
                    Id = d.Id,
                    DeviceCode = d.DeviceCode,
                    Name = d.Name,
                    IsOnline = d.IsOnline,
                    IsVirtual = d.IsVirtual,
                    CreatedAt = d.CreatedAt,
                    MetricsCount = d.SensorMetrics.Count
                })
                .ToListAsync();

            try
            {
                var cacheOptions = new DistributedCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1)
                };
                await _cache.SetStringAsync(cacheKey, JsonSerializer.Serialize(devices), cacheOptions);
            }
            catch (Exception)
            {
                // Failed to write cache
            }

            return Ok(devices);
        }

        /// <summary>
        /// Get the latest 50 sensor metrics for a specific device by device code.
        /// </summary>
        /// <param name="deviceCode">The device code to query</param>
        /// <returns>Latest 50 SensorMetric records ordered by timestamp descending</returns>
        [HttpGet("{deviceCode}/history")]
        public async Task<ActionResult<IEnumerable<object>>> GetSensorHistory(string deviceCode)
        {
            // Find the device by device code
            var device = await _context.Devices
                .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

            if (device == null)
            {
                return NotFound(new { message = $"Device with code '{deviceCode}' not found." });
            }

            // Query the latest 50 sensor metrics for this device, ordered by timestamp descending
            var metrics = await _context.SensorMetrics
                .Where(m => m.DeviceId == device.Id)
                .OrderByDescending(m => m.Timestamp)
                .Take(50)
                .Select(m => new
                {
                    m.Id,
                    m.Temperature,
                    m.Humidity,
                    m.Timestamp
                })
                .ToListAsync();

            return Ok(new
            {
                deviceCode = device.DeviceCode,
                deviceName = device.Name,
                isOnline = device.IsOnline,
                metrics = metrics
            });
        }

        /// <summary>
        /// Get the latest status and metrics for a specific device by device code.
        /// </summary>
        /// <param name="deviceCode">The device code to query</param>
        /// <returns>Latest status of the device</returns>
        [HttpGet("{deviceCode}/latest")]
        public async Task<ActionResult<DeviceLatestStatusDto>> GetLatestStatus(string deviceCode)
        {
            var cacheKey = $"device:{deviceCode}:latest_status";

            try
            {
                var cachedData = await _cache.GetStringAsync(cacheKey);
                if (!string.IsNullOrEmpty(cachedData))
                {
                    var cachedStatus = JsonSerializer.Deserialize<DeviceLatestStatusDto>(cachedData);
                    if (cachedStatus != null)
                    {
                        return Ok(cachedStatus);
                    }
                }
            }
            catch (Exception)
            {
                // Fallback to DB query
            }

            // Find the device
            var device = await _context.Devices
                .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

            if (device == null)
            {
                return NotFound(new { message = $"Device with code '{deviceCode}' not found." });
            }

            // Get the latest sensor metric
            var latestMetric = await _context.SensorMetrics
                .Where(m => m.DeviceId == device.Id)
                .OrderByDescending(m => m.Timestamp)
                .FirstOrDefaultAsync();

            var status = new DeviceLatestStatusDto
            {
                Temperature = latestMetric?.Temperature ?? 0.0,
                Humidity = latestMetric?.Humidity ?? 0.0,
                Timestamp = latestMetric?.Timestamp ?? DateTime.UtcNow,
                IsOnline = device.IsOnline
            };

            try
            {
                var cacheOptions = new DistributedCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5)
                };
                await _cache.SetStringAsync(cacheKey, JsonSerializer.Serialize(status), cacheOptions);
            }
            catch (Exception)
            {
                // Failed to write cache
            }

            return Ok(status);
        }
    }

    public class DeviceDto
    {
        public Guid Id { get; set; }
        public string DeviceCode { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsOnline { get; set; }
        public bool IsVirtual { get; set; }
        public DateTime CreatedAt { get; set; }
        public int MetricsCount { get; set; }
    }

    public class DeviceLatestStatusDto
    {
        public double Temperature { get; set; }
        public double Humidity { get; set; }
        public DateTime Timestamp { get; set; }
        public bool IsOnline { get; set; }
    }
}
