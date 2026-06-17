using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace Backend.Data
{
    public class Device
    {
        [Key]
        public Guid Id { get; set; }

        [Required]
        [MaxLength(50)]
        public string DeviceCode { get; set; } = string.Empty; // Dùng làm Topic MQTT

        [Required]
        [MaxLength(100)]
        public string Name { get; set; } = string.Empty;

        public bool IsVirtual { get; set; } = false;

        public bool IsOnline { get; set; } = false;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation property: Một thiết bị có nhiều bản ghi metrics
        public virtual ICollection<SensorMetric> SensorMetrics { get; set; } = new List<SensorMetric>();
    }

    public class SensorMetric
    {
        [Key]
        public long Id { get; set; }

        // Khóa ngoại liên kết tới Device
        public Guid DeviceId { get; set; }

        public double Temperature { get; set; }

        public double Humidity { get; set; }

        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        // Navigation property liên kết ngược lại thiết bị
        public virtual Device? Device { get; set; }
    }
}