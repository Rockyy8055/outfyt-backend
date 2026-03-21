# Outfyt Store Web Dashboard API Documentation

## Overview

This document describes the API endpoints for the Outfyt Store Web Dashboard. All endpoints are protected by JWT authentication unless otherwise noted.

---

## Authentication

### Send OTP

**POST** `/web/auth/send-otp`

Request body:
```json
{
  "phone": "+919876543210"
}
```

Response:
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

### Verify OTP

**POST** `/web/auth/verify-otp`

Request body:
```json
{
  "phone": "+919876543210",
  "otp": "123456"
}
```

Response:
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "name": "Store Name",
    "phone": "+919876543210",
    "email": "store@example.com",
    "role": "STORE",
    "store": {
      "id": "uuid",
      "name": "My Fashion Store",
      "address": "123 Main Street"
    }
  }
}
```

---

## Store Profile

### Get Store Profile

**GET** `/web/store/me`

Headers:
```
Authorization: Bearer <accessToken>
```

Response:
```json
{
  "id": "uuid",
  "name": "My Fashion Store",
  "address": "123 Main Street, City",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "gstNumber": "29ABCDE1234F1Z5",
  "phone": "+919876543210",
  "owner": {
    "id": "uuid",
    "name": "Owner Name",
    "phone": "+919876543210",
    "email": "owner@example.com"
  }
}
```

### Update Store Profile

**PUT** `/web/store/me`

Headers:
```
Authorization: Bearer <accessToken>
```

Request body:
```json
{
  "name": "My Updated Store",
  "address": "456 New Address",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "gstNumber": "29ABCDE1234F1Z5",
  "phone": "+919876543210"
}
```

### Get Store Statistics

**GET** `/web/store/stats`

Response:
```json
{
  "totalProducts": 150,
  "totalOrders": 500,
  "pendingOrders": 5,
  "completedOrders": 450
}
```

---

## Products

### List Products

**GET** `/products?page=1&limit=20`

Response:
```json
{
  "products": [
    {
      "id": "uuid",
      "name": "Cotton T-Shirt",
      "price": 599,
      "images": ["https://..."],
      "storeId": "uuid",
      "category": "T-Shirts",
      "inventory": [
        { "size": "S", "stock": 10 },
        { "size": "M", "stock": 15 }
      ],
      "createdAt": "2026-03-21T...",
      "updatedAt": "2026-03-21T..."
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

### Get Single Product

**GET** `/products/:id`

### Create Product

**POST** `/products`

Request body:
```json
{
  "name": "Cotton T-Shirt",
  "price": 599,
  "images": ["https://cloudinary.com/..."],
  "category": "T-Shirts",
  "sizes": [
    { "size": "S", "stock": 10 },
    { "size": "M", "stock": 15 },
    { "size": "L", "stock": 20 }
  ]
}
```

### Update Product

**PUT** `/products/:id`

### Delete Product

**DELETE** `/products/:id`

---

## Bulk Product Upload

### Upload CSV/Excel

**POST** `/products/bulk-upload`

Headers:
```
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

Form data:
- `file`: CSV or Excel file (.csv, .xlsx, .xls)

Response:
```json
{
  "success": 45,
  "failed": 5,
  "errors": [
    { "row": 12, "message": "Valid price is required" },
    { "row": 23, "message": "Name is required" }
  ],
  "products": [
    { "id": "uuid", "name": "Cotton T-Shirt" },
    { "id": "uuid", "name": "Denim Jeans" }
  ]
}
```

---

## Image Upload

### Upload Single Image

**POST** `/upload/image`

Headers:
```
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

Form data:
- `file`: Image file (jpg, png, gif, webp)

Response:
```json
{
  "url": "https://res.cloudinary.com/.../image.jpg",
  "publicId": "outfyt/stores/uuid/abc123",
  "width": 1200,
  "height": 1200,
  "format": "jpg"
}
```

### Upload Bulk Images (ZIP)

**POST** `/upload/bulk-images`

Headers:
```
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

Form data:
- `archive`: ZIP file containing images

Response:
```json
{
  "images": [
    { "name": "product1.jpg", "url": "https://..." },
    { "name": "product2.jpg", "url": "https://..." }
  ]
}
```

---

## Sample CSV Format

Create a CSV file with the following columns:

```csv
name,price,category,size,stock,color,image_url,image_name
Cotton T-Shirt,599,T-Shirts,S,10,Blue,https://example.com/image.jpg,
Denim Jeans,1299,Jeans,M,15,Black,,jeans_front
Summer Dress,899,Dresses,L,5,Red,https://example.com/dress.jpg,
Casual Shirt,799,Shirts,XL,20,White,,shirt_white
```

### Column Descriptions

| Column | Required | Description |
|--------|----------|-------------|
| name | Yes | Product name |
| price | Yes | Product price (positive number) |
| category | No | Product category (e.g., T-Shirts, Jeans, Dresses) |
| size | No | Size variant (S, M, L, XL, etc.) |
| stock | No | Stock quantity for this size (default: 0) |
| color | No | Product color |
| image_url | No* | Direct URL to product image |
| image_name | No* | Name of uploaded image (maps to /upload/bulk-images) |

*Either `image_url` or `image_name` can be used. If using `image_name`, first upload images via `/upload/bulk-images` endpoint.

---

## Error Handling

All errors return a structured JSON:

```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request"
}
```

For bulk upload errors, row numbers are included:

```json
{
  "success": 0,
  "failed": 2,
  "errors": [
    { "row": 3, "message": "Name is required" },
    { "row": 5, "message": "Valid price is required" }
  ],
  "products": []
}
```

---

## Environment Variables Required

Add these to your `.env` file:

```env
# Cloudinary (for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# JWT (already exists)
SUPABASE_JWT_SECRET=your_jwt_secret

# Database (already exists)
DATABASE_URL=your_database_url
```

---

## Setup Instructions

1. Install dependencies:
```bash
npm install
```

2. Run Prisma migration:
```bash
npx prisma migrate dev --name add_store_product_fields
```

3. Start the server:
```bash
npm run start:dev
```

---

## Security Notes

- All product and upload endpoints require JWT authentication
- Store owners can only access their own data
- Role-based access control (STORE role required)
- Images are uploaded to Cloudinary with folder isolation per store
