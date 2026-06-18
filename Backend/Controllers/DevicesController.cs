using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Backend.Data;
using System.ComponentModel.DataAnnotations;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class DevicesController : ControllerBase
    {
        private readonly AppDbContext _context;

        public DevicesController(AppDbContext context)
        {
            _context = context;
        }

        /// <summary>
        /// Create a new device (including virtual devices for testing).
        /// </summary>
        /// <param name="request">Device creation request</param>
        /// <returns>Newly created device</returns>
        [HttpPost("create")]
        public async Task<ActionResult<object>> CreateDevice([FromBody] CreateDeviceRequest request)
        {
            // Validate input
            if (string.IsNullOrWhiteSpace(request.DeviceCode))
            {
                return BadRequest(new { message = "DeviceCode is required." });
            }

            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return BadRequest(new { message = "Name is required." });
            }

            // Check if device already exists
            var existingDevice = await _context.Devices
                .FirstOrDefaultAsync(d => d.DeviceCode == request.DeviceCode);

            if (existingDevice != null)
            {
                return Conflict(new { message = $"Device with code '{request.DeviceCode}' already exists." });
            }

            // Create new device
            var newDevice = new Device
            {
                Id = Guid.NewGuid(),
                DeviceCode = request.DeviceCode,
                Name = request.Name,
                IsVirtual = request.IsVirtual ?? false,
                IsOnline = request.IsVirtual ?? false, // Virtual devices are online by default
                CreatedAt = DateTime.UtcNow
            };

            _context.Devices.Add(newDevice);

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                _context.Entry(newDevice).State = EntityState.Detached;
                return Conflict(new { message = "Failed to create device. Device code may already exist.", error = ex.Message });
            }

            return CreatedAtAction(nameof(GetDeviceByCode), new { deviceCode = newDevice.DeviceCode }, new
            {
                newDevice.Id,
                newDevice.DeviceCode,
                newDevice.Name,
                newDevice.IsVirtual,
                newDevice.IsOnline,
                newDevice.CreatedAt
            });
        }

        /// <summary>
        /// Get a device by device code.
        /// </summary>
        /// <param name="deviceCode">Device code</param>
        /// <returns>Device details</returns>
        [HttpGet("{deviceCode}")]
        public async Task<ActionResult<object>> GetDeviceByCode(string deviceCode)
        {
            var device = await _context.Devices
                .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

            if (device == null)
            {
                return NotFound(new { message = $"Device with code '{deviceCode}' not found." });
            }

            return Ok(new
            {
                device.Id,
                device.DeviceCode,
                device.Name,
                device.IsVirtual,
                device.IsOnline,
                device.CreatedAt
            });
        }

        /// <summary>
        /// Update device status (e.g., toggle IsOnline or rename).
        /// </summary>
        /// <param name="deviceCode">Device code</param>
        /// <param name="request">Update request</param>
        /// <returns>Updated device</returns>
        [HttpPut("{deviceCode}")]
        public async Task<ActionResult<object>> UpdateDevice(string deviceCode, [FromBody] UpdateDeviceRequest request)
        {
            var device = await _context.Devices
                .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

            if (device == null)
            {
                return NotFound(new { message = $"Device with code '{deviceCode}' not found." });
            }

            if (!string.IsNullOrWhiteSpace(request.Name))
            {
                device.Name = request.Name;
            }

            if (request.IsOnline.HasValue)
            {
                device.IsOnline = request.IsOnline.Value;
            }

            _context.Devices.Update(device);
            await _context.SaveChangesAsync();

            return Ok(new
            {
                device.Id,
                device.DeviceCode,
                device.Name,
                device.IsVirtual,
                device.IsOnline,
                device.CreatedAt
            });
        }

        /// <summary>
        /// Delete a device.
        /// </summary>
        /// <param name="deviceCode">Device code</param>
        /// <returns>Success message</returns>
        [HttpDelete("{deviceCode}")]
        public async Task<ActionResult<object>> DeleteDevice(string deviceCode)
        {
            var device = await _context.Devices
                .FirstOrDefaultAsync(d => d.DeviceCode == deviceCode);

            if (device == null)
            {
                return NotFound(new { message = $"Device with code '{deviceCode}' not found." });
            }

            _context.Devices.Remove(device);
            await _context.SaveChangesAsync();

            return Ok(new { message = $"Device '{deviceCode}' deleted successfully." });
        }
    }

    public class CreateDeviceRequest
    {
        [Required]
        public string DeviceCode { get; set; } = string.Empty;

        [Required]
        public string Name { get; set; } = string.Empty;

        public bool? IsVirtual { get; set; }
    }

    public class UpdateDeviceRequest
    {
        public string? Name { get; set; }

        public bool? IsOnline { get; set; }
    }
}
