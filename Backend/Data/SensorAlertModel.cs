using System;
using System.ComponentModel.DataAnnotations;

namespace Backend.Data
{
    /// <summary>
    /// Represents a detected temperature anomaly alert from the Z-Score detector.
    /// </summary>
    public class SensorAlert
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        [Required]
        [MaxLength(50)]
        public string DeviceCode { get; set; } = string.Empty;

        [Required]
        [MaxLength(500)]
        public string Message { get; set; } = string.Empty;

        public double Temperature { get; set; }

        /// <summary>
        /// The calculated Z-Score that triggered this alert (Z > 3.0 = anomaly).
        /// </summary>
        public double ZScore { get; set; }

        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// Whether the alert has been acknowledged by the user.
        /// Defaults to false (unread).
        /// </summary>
        public bool IsRead { get; set; } = false;
    }
}
