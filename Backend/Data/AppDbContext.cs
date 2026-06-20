using Microsoft.EntityFrameworkCore;

namespace Backend.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        public DbSet<Device> Devices { get; set; }
        public DbSet<SensorMetric> SensorMetrics { get; set; }
        public DbSet<SensorAlert> SensorAlerts { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Cấu hình mối quan hệ 1-N rõ ràng
            modelBuilder.Entity<SensorMetric>()
                .HasOne(m => m.Device)
                .WithMany(d => d.SensorMetrics)
                .HasForeignKey(m => m.DeviceId)
                .OnDelete(DeleteBehavior.Cascade); // Nếu xóa thiết bị, tự động xóa sạch log dữ liệu của thiết bị đó

            // Tạo Index cho DeviceCode để Backend truy vấn tìm DeviceId cực nhanh khi nhận tin nhắn MQTT
            modelBuilder.Entity<Device>()
                .HasIndex(d => d.DeviceCode)
                .IsUnique();

            // Index phức hợp để truy vấn alert theo thiết bị + thời gian cực nhanh
            modelBuilder.Entity<SensorAlert>()
                .HasIndex(a => new { a.DeviceCode, a.Timestamp });

            // Index riêng cho IsRead để lọc cảnh báo chưa đọc nhanh
            modelBuilder.Entity<SensorAlert>()
                .HasIndex(a => a.IsRead);
        }
    }
}