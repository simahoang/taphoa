// Kinh tế VNĐ thật: 1 đơn vị tiền = 1đ, hiển thị bằng toLocaleString("vi-VN").
// Mỗi quầy là 1 mặt hàng: mở quầy (unlockCost) -> nhập theo lô (batchSize/batchCost)
// -> bán từng đơn vị theo DOANH THU (vốn + lãi) -> hết hàng -> nhập lô tiếp.
// 1 đơn vị bán ra thu: vốn (batchCost/batchSize) + lãi (unitProfit).
// Ví dụ pin: 110.000/5 + 6.000 = 28.000đ/vỉ — đúng giá vỉ pin ngoài chợ.
export const SHOPS = [
  { id: "water", name: "Tủ nước lạnh", icon: "🥤", unit: "chai", unlockCost: 50000, batchSize: 24, batchCost: 96000, unitProfit: 1800 },
  { id: "snack", name: "Quầy bánh kẹo", icon: "🍬", unit: "gói", unlockCost: 120000, batchSize: 20, batchCost: 120000, unitProfit: 2000 },
  { id: "tissue", name: "Khăn giấy", icon: "🧻", unit: "bịch", unlockCost: 250000, batchSize: 10, batchCost: 110000, unitProfit: 3000 },
  { id: "school", name: "Dụng cụ học sinh", icon: "✏️", unit: "quyển", unlockCost: 600000, batchSize: 20, batchCost: 160000, unitProfit: 4000 },
  { id: "rice", name: "Gạo", icon: "🍚", unit: "kg", unlockCost: 1500000, batchSize: 25, batchCost: 450000, unitProfit: 5000 },
  { id: "pin", name: "Pin", icon: "🔋", unit: "vỉ", unlockCost: 4000000, batchSize: 5, batchCost: 110000, unitProfit: 6000 },
  { id: "claw", name: "Máy gắp thú", icon: "🧸", unit: "lượt", unlockCost: 8000000, batchSize: 30, batchCost: 90000, unitProfit: 7000 },
  { id: "spice", name: "Quầy gia vị", icon: "🧂", unit: "chai", unlockCost: 15000000, batchSize: 6, batchCost: 210000, unitProfit: 10000 },
];

// Chủ quán (staff = 0) tự bán, chậm hơn NV cấp 1.
export const OWNER_SERVE_TIME = 2.2; // giây / khách

// Chỉ có DUY NHẤT 1 nhân viên. staff = cấp NV (0 = chủ quán tự bán, 1..5 = đã thuê).
// Giá nhân 1000 lần so với bản "xu" cũ, theo mô hình tiền VNĐ.
export const STAFF_UPGRADES = [
  { level: 1, cost: 300000, serveTime: 1.1 },
  { level: 2, cost: 900000, serveTime: 0.8 },
  { level: 3, cost: 2500000, serveTime: 0.55 },
  { level: 4, cost: 7000000, serveTime: 0.35 },
  { level: 5, cost: 18000000, serveTime: 0.2 },
];

export const START_MONEY = 500000; // 500k vốn khởi nghiệp
export const SAVE_KEY = "game3_idle_v4"; // reset: giá mở sắp lại tăng dần theo lãi
