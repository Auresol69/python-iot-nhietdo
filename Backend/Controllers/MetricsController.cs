using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MetricsController : ControllerBase
    {
        private readonly AppDbContext _context;

        public MetricsController(AppDbContext context)
        {
            _context = context;
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
    }
}
