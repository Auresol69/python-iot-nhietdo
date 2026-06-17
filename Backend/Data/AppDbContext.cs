using Microsoft.EntityFrameworkCore;

namespace Backend.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        public DbSet<Device> Devices { get; set; }
        public DbSet<SensorMetric> SensorMetrics { get; set; }

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
        }
    }
}