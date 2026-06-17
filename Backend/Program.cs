using Microsoft.EntityFrameworkCore;
using Backend.Data;
using Backend.Services;

var builder = WebApplication.CreateBuilder(args);

// Get SqlServer Connection String
var connectionString = builder.Configuration.GetConnectionString("SqlServer");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(connectionString));

// Register MQTT Background Service as a Hosted Service
builder.Services.AddHostedService<MqttBackgroundService>();

var app = builder.Build();

// Define a simple root endpoint for checking service status
app.MapGet("/", () => "IoT MQTT Backend is running.");

app.Run();
