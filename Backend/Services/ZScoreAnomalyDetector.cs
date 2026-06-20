using System.Collections.Concurrent;

namespace Backend.Services
{
    public class ZScoreAnomalyDetector
    {
        // Kích thước cửa sổ trượt: Lưu 10 giá trị gần nhất
        private readonly int _windowSize = 10;
        
        // Ngưỡng Z-Score: > 3 là bất thường (độ tin cậy 99.7%)
        private readonly double _threshold = 3.0;

        // Từ điển lưu trữ danh sách nhiệt độ cho từng thiết bị
        // Dùng ConcurrentDictionary để an toàn khi chạy đa luồng (Thread-safe)
        private readonly ConcurrentDictionary<string, Queue<double>> _deviceHistories = new();

        /// <summary>
        /// Kiểm tra xem giá trị mới có phải là đột biến (Anomaly) hay không
        /// </summary>
        public bool IsAnomaly(string deviceCode, double newValue, out double currentZScore)
        {
            currentZScore = 0;
            
            // Lấy hàng đợi của thiết bị này, nếu chưa có thì tạo mới
            var history = _deviceHistories.GetOrAdd(deviceCode, _ => new Queue<double>());

            // Khóa Queue lại để tránh đụng độ nếu 2 gói MQTT vào cùng 
            // C# sẽ sử dụng chính địa chỉ vùng nhớ của object history để làm một chiếc "chìa khóa" (Monitor lock)
            lock (history)
            {
                // Nếu chưa gom đủ 10 số liệu để làm mẫu chuẩn -> Bỏ qua, chỉ lưu data
                if (history.Count < _windowSize)
                {
                    history.Enqueue(newValue);
                    return false;
                }

                // 1. Tính giá trị trung bình (Mean - μ)
                double mean = history.Average();

                // 2. Tính phương sai (Variance - σ²)
                double variance = history.Average(v => Math.Pow(v - mean, 2));

                // 3. Tính độ lệch chuẩn (Standard Deviation - σ)
                double stdDev = Math.Sqrt(variance);

                // Xử lý ngoại lệ: Nếu 10 lần trước nhiệt độ đứng yên tuyệt đối ở 28.0, độ lệch chuẩn sẽ = 0.
                // Tránh lỗi chia cho 0.
                if (stdDev == 0) stdDev = 0.0001; 

                // 4. Tính Z-Score
                currentZScore = Math.Abs(newValue - mean) / stdDev;

                // 5. Trượt cửa sổ: Xóa giá trị cũ nhất, nạp giá trị mới nhất vào
                history.Dequeue();
                history.Enqueue(newValue);

                // 6. Ra quyết định
                return currentZScore > _threshold;
            }
        }
    }
}