# server-web

Server Web API bằng **Node.js** kèm **WebSocket backend** để kết nối và lấy dữ liệu PlaceholderAPI từ các Minecraft server.

📦 Đây là một backend đơn giản sử dụng `express` và `ws` cho API REST và WebSocket. ([GitHub][1])

## 📌 Tính năng

* 📡 **HTTP API** để client gửi yêu cầu lấy dữ liệu Placeholder (`POST /api/request-papi`). ([GitHub][2])
* 🤝 **WebSocket server** để các Minecraft server kết nối và gửi/nhận dữ liệu động. ([GitHub][3])
* 🛡️ Rate-limiting trên API và WebSocket để tránh spam. ([GitHub][2])
* 💡 Hỗ trợ nhận placeholder qua **server_id** hoặc **ip + port**. ([GitHub][2])

---

## 🧠 Yêu cầu

* Node.js >= 18
* Chạy trên máy chủ có port 80 mở hoặc cấu hình proxy/nginx thích hợp

---

## 🔧 Cài đặt

1. Clone repository:

   ```bash
   git clone https://github.com/Jj87-huy/server-web.git
   cd server-web
   ```

2. Cài dependencies:

   ```bash
   npm install
   ```

3. Tạo cấu trúc folder và file:

   * `data/keys.json`: chứa API keys hợp lệ, ví dụ:

     ```json
     {
       "key": ["my1stKey", "anotherKey"]
     }
     ```

   * `data/key.lock.json`: hệ thống sẽ tạo tự động khi server khởi động. ([GitHub][3])

---

## ▶️ Chạy server

```bash
npm start
```

hoặc (tuỳ script):

```bash
npm run st
```

Server HTTP sẽ chạy trên port **80**. ([GitHub][1])

---

## 🚀 API HTTP

### 📍 POST `/api/request-papi`

Lấy placeholder từ server đã kết nối qua WebSocket.

#### Request body

```json
{
  "server_id": "example-server",
  "placeholders": ["hp", "level"],
  "player": "Steve",
  "exp": "default"
}
```

Hoặc dùng IP:

```json
{
  "server_ip": "123.123.123.12",
  "server_port": 25565,
  "placeholders": ["hp"]
}
```

#### Response

* `200 OK` – thành công với dữ liệu placeholder. ([GitHub][2])
* `429` – rate limit HTTP hoặc WebSocket. ([GitHub][2])
* `503` – server offline. ([GitHub][2])
* `504` – timeout từ WebSocket backend. ([GitHub][2])

---

## 🔌 WebSocket Backend

Server WebSocket chạy trên port **25178** (mặc định). ([GitHub][3])

### Kết nối WebSocket từ Minecraft server

Server cần gửi payload JSON kiểu sau để auth:

```json
{
  "type": "auth",
  "api_key": "my-api-key",
  "server_id": "my-server",
  "server_ip": "123.12.1.1",
  "server_port": "25565"
}
```

Sau khi kết nối xác thực thành công, backend sẽ giữ kết nối WebSocket để nhận các request từ HTTP API và gửi phản hồi về server đó. ([GitHub][3])

---

## 🗂️ Cấu trúc thư mục

```
.
├── data/                  # keys.json + locks file
├── routes/
│   └── papi.js           # API route xử lý placeholder
├── websocket.js          # WebSocket server & core logic
├── index.js              # Entry point backend HTTP
├── package.json
└── README.md
```

---

## 🧪 Phát triển thêm

* Bổ sung **trạng thái kết nối** WebSocket trên HTTP endpoint
* Tạo **UI dashboard** để xem server đã auth
* Thêm **logging / metrics** chi tiết

---

## 📄 Giấy phép

ISC License


[1]: https://github.com/Jj87-huy/server-web/blob/main/package.json "server-web/package.json at main · Jj87-huy/server-web · GitHub"
[2]: https://raw.githubusercontent.com/Jj87-huy/server-web/main/routes/papi.js "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/Jj87-huy/server-web/main/websocket.js "raw.githubusercontent.com"
