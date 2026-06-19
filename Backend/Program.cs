using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Services;
using Backend.Hubs;

var builder = WebApplication.CreateBuilder(args);

// Get SqlServer Connection String
var connectionString = builder.Configuration.GetConnectionString("SqlServer");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(connectionString, SqlOptions =>
    {
        SqlOptions.EnableRetryOnFailure(
            maxRetryCount: 10,
            maxRetryDelay: TimeSpan.FromSeconds(5),
            errorNumbersToAdd: null);
    }));

// Register MQTT Background Service as a Hosted Service
builder.Services.AddHostedService<MqttBackgroundService>();

// Add SignalR
builder.Services.AddSignalR();

// Add Controllers
builder.Services.AddControllers();

// Register Redis Cache
var redisConnectionString = builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379";
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = redisConnectionString;
});

// Configure CORS to allow React frontend
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy
            .WithOrigins("http://localhost:5173", "http://localhost:3000")
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials();
    });
});

var app = builder.Build();

// Use CORS middleware
app.UseCors("AllowReactApp");

// Define a simple root endpoint for checking service status
app.MapGet("/", () => "IoT MQTT Backend is running.");

// Map controllers
app.MapControllers();

// Map SignalR Hub
app.MapHub<SensorHub>("/hubs/sensor");

using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    // Lệnh này sẽ tự động tạo bảng nếu chưa có
    dbContext.Database.Migrate();
}

app.Run();
