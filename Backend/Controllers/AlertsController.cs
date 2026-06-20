using Backend.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Backend.Controllers
{
    [ApiController]
    [Route("api/alerts")]
    public class AlertsController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly ILogger<AlertsController> _logger;

        public AlertsController(AppDbContext dbContext, ILogger<AlertsController> logger)
        {
            _dbContext = dbContext;
            _logger = logger;
        }

        /// <summary>
        /// GET /api/alerts/recent
        /// Returns the top 20 most recent UNREAD sensor anomaly alerts, newest first.
        /// </summary>
        [HttpGet("recent")]
        public async Task<IActionResult> GetRecentAlerts()
        {
            try
            {
                var alerts = await _dbContext.SensorAlerts
                    .Where(a => !a.IsRead)
                    .OrderByDescending(a => a.Timestamp)
                    .Take(20)
                    .Select(a => new
                    {
                        a.Id,
                        a.DeviceCode,
                        a.Message,
                        a.Temperature,
                        a.ZScore,
                        a.Timestamp,
                        a.IsRead
                    })
                    .ToListAsync();

                return Ok(alerts);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching recent alerts.");
                return StatusCode(500, "Internal server error while fetching alerts.");
            }
        }

        /// <summary>
        /// PATCH /api/alerts/{id}/read
        /// Marks a single alert as read (acknowledged).
        /// </summary>
        [HttpPatch("{id}/read")]
        public async Task<IActionResult> MarkAlertAsRead(Guid id)
        {
            try
            {
                var alert = await _dbContext.SensorAlerts.FindAsync(id);

                if (alert == null)
                {
                    return NotFound(new { message = $"Alert with ID '{id}' not found." });
                }

                if (!alert.IsRead)
                {
                    alert.IsRead = true;
                    _dbContext.SensorAlerts.Update(alert);
                    await _dbContext.SaveChangesAsync();
                }

                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error marking alert {AlertId} as read.", id);
                return StatusCode(500, "Internal server error while updating alert.");
            }
        }

        /// <summary>
        /// PATCH /api/alerts/read-all
        /// Marks ALL unread alerts as read at once.
        /// </summary>
        [HttpPatch("read-all")]
        public async Task<IActionResult> MarkAllAlertsAsRead()
        {
            try
            {
                var unreadAlerts = await _dbContext.SensorAlerts
                    .Where(a => !a.IsRead)
                    .ToListAsync();

                foreach (var alert in unreadAlerts)
                {
                    alert.IsRead = true;
                }

                await _dbContext.SaveChangesAsync();
                return Ok(new { message = $"Marked {unreadAlerts.Count} alert(s) as read." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error marking all alerts as read.");
                return StatusCode(500, "Internal server error.");
            }
        }
    }
}
