# allqrmap

Istanbul restaurant map with QR menu links

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Index HTML |
| `/api/restaurants` | GET | All restaurants |
| `/api/restaurants` | POST | Add new restaurant |
| `/api/admin/update-coords** | POST | Bulk update coordinates (requires ADMIN_API_KEY env) |
| `/api/ai-search** | POST | AI search with Gemini |

**Admin endpoint requires `ADMIN_API_KEY` environment variable.**

## Update Coordinates Example

```bash
curl -X POST https://your-app.onrender.com/api/admin/update-coords \
  -H "Content-Type: application/json" \
  -H "ADMIN_API_KEY: your-secret-key" \
  -d '{
    "restaurants": [
      {"id": 1, "lat": 41.0563, "lng": 29.0346, "menu_url": "https://hundredistanbul.com/"},
      {"id": 8, "lat": 40.9551, "lng": 29.0946}
    ]
  }'
```

## Environment Variables

- `ADMIN_API_KEY` - Secret key for admin endpoints
- `GEMINI_API_KEY` - Google Gemini API key for AI search
- `GA_MEASUREMENT_ID` - Google Analytics measurement ID