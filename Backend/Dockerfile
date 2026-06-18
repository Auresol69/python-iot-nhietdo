# Stage 1: Build
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

# Copy project file
COPY ["Backend.csproj", "./"]

# Restore dependencies
RUN dotnet restore "Backend.csproj"

# Copy source code
COPY . .

# Build the application (Release configuration)
RUN dotnet build "Backend.csproj" -c Release -o /app/build

# Publish the application
RUN dotnet publish "Backend.csproj" -c Release -o /app/publish

# Stage 2: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:8.0

WORKDIR /app

# Copy published artifacts from build stage
COPY --from=build /app/publish .

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD dotnet-healthcheck || exit 1

# Set environment variable
ENV ASPNETCORE_URLS=http://+:8080

# Run the application
ENTRYPOINT ["dotnet", "Backend.dll"]
