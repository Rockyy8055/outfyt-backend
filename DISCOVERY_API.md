# Outfyt Discovery & Recommendation API

## 🚀 Overview

Production-grade recommendation and discovery system with Zomato-like algorithm.

---

## 📍 HOME FEED API

### GET `/discovery/home-feed`

Returns complete home feed data.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| lat | number | ✅ | User latitude |
| lng | number | ✅ | User longitude |

**Response:**
```json
{
  "nearbyStores": [
    {
      "id": "uuid",
      "name": "Fashion Store",
      "latitude": 12.9716,
      "longitude": 77.5946,
      "address": "123 Main St",
      "rating": 4.5,
      "totalOrders": 150,
      "category": "Men",
      "tags": ["casual", "formal"],
      "distance": 2.35
    }
  ],
  "recommendedStores": [
    {
      "id": "uuid",
      "name": "Trending Store",
      "rating": 4.8,
      "totalOrders": 500,
      "distance": 1.2,
      "score": 0.85
    }
  ],
  "categories": [
    { "id": "uuid", "name": "Men", "slug": "men", "icon": "👔" }
  ],
  "filters": [
    { "id": "trending", "name": "Trending", "slug": "trending" }
  ]
}
```

---

## 📍 NEARBY STORES

### GET `/discovery/nearby`

Returns stores sorted by distance using Haversine formula.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| lat | number | ✅ | User latitude |
| lng | number | ✅ | User longitude |
| radius | number | ❌ | Radius in km (default: 30) |

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Store Name",
    "address": "Address",
    "rating": 4.5,
    "totalOrders": 100,
    "distance": 2.35
  }
]
```

---

## 🧠 RECOMMENDED STORES

### GET `/discovery/recommended`

Returns personalized store recommendations based on scoring algorithm.

**Scoring Formula:**
```
score = (rating * 0.3) + (popularity * 0.25) + (distance_score * 0.25) + (recency * 0.1) + (user_preference * 0.1)
```

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| lat | number | ✅ | User latitude |
| lng | number | ✅ | User longitude |

---

## 🏷️ CATEGORIES

### GET `/discovery/categories`

Returns dynamic categories from database.

**Response:**
```json
[
  { "id": "uuid", "name": "Men", "slug": "men", "icon": "👔" },
  { "id": "uuid", "name": "Women", "slug": "women", "icon": "👗" },
  { "id": "uuid", "name": "Kids", "slug": "kids", "icon": "🧒" },
  { "id": "uuid", "name": "Trending", "slug": "trending", "icon": "🔥" },
  { "id": "uuid", "name": "New", "slug": "new", "icon": "✨" }
]
```

---

## 🔍 SEARCH

### GET `/discovery/search`

Search stores and products.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| q | string | ✅ | Search query |
| lat | number | ❌ | User latitude |
| lng | number | ❌ | User longitude |

**Response:**
```json
{
  "stores": [
    {
      "id": "uuid",
      "name": "Fashion Hub",
      "address": "Address",
      "rating": 4.5
    }
  ],
  "products": [
    {
      "id": "uuid",
      "name": "Blue T-Shirt",
      "price": 599,
      "images": ["url"],
      "storeName": "Fashion Hub"
    }
  ]
}
```

---

## 🔬 FILTERS

### GET `/discovery/filters`

Returns available filters.

**Response:**
```json
[
  { "id": "trending", "name": "Trending", "slug": "trending" },
  { "id": "top-rated", "name": "Top Rated", "slug": "top-rated" },
  { "id": "nearby", "name": "Nearby", "slug": "nearby" },
  { "id": "new", "name": "New", "slug": "new" }
]
```

### GET `/discovery/stores/filter`

Get stores by filter.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| filter | string | ✅ | Filter slug (trending/top-rated/nearby/new) |
| lat | number | ✅ | User latitude |
| lng | number | ✅ | User longitude |

---

## 🔮 DISCOVER

### GET `/discovery/discover`

Returns discovery content (suggestions, trending).

**Headers:** `Authorization: Bearer <token>` (optional)

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| lat | number | ❌ | User latitude |
| lng | number | ❌ | User longitude |

**Response:**
```json
{
  "suggestions": ["t-shirts", "jeans", "dresses"],
  "trendingSearches": ["sneakers", "kurta", "jackets"],
  "trendingProducts": [...],
  "newProducts": [...]
}
```

---

## ❤️ WISHLIST

### GET `/wishlist`

Get user's wishlist.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
[
  {
    "id": "uuid",
    "productId": "uuid",
    "createdAt": "2024-01-01",
    "product": {
      "id": "uuid",
      "name": "Product Name",
      "price": 599,
      "images": ["url"],
      "store": { "id": "uuid", "name": "Store" }
    }
  }
]
```

### POST `/wishlist/:productId`

Add product to wishlist.

### DELETE `/wishlist/:productId`

Remove product from wishlist.

### GET `/wishlist/count`

Get wishlist count.

---

## 👤 PROFILE

### GET `/profile`

Get user profile with stats.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "id": "uuid",
  "name": "John Doe",
  "phone": "+91...",
  "email": "john@example.com",
  "ordersCount": 10,
  "wishlistCount": 5,
  "addresses": []
}
```

### PUT `/profile`

Update profile.

**Body:**
```json
{
  "name": "John Doe",
  "phone": "+91...",
  "email": "john@example.com"
}
```

### GET `/profile/orders`

Get order history.

### GET `/profile/stats`

Get user statistics.

**Response:**
```json
{
  "totalOrders": 10,
  "completedOrders": 8,
  "totalSpent": 5000,
  "wishlistCount": 5
}
```

---

## 📊 TRACKING

### POST `/discovery/activity`

Track user activity for recommendations.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "activityType": "VIEW",
  "storeId": "uuid",
  "productId": "uuid"
}
```

**Activity Types:**
- `VIEW` - User viewed store/product
- `CLICK` - User clicked on store/product
- `ORDER` - User placed order
- `SEARCH` - User searched

---

## 🏪 STORE PRODUCTS

### GET `/discovery/stores/:storeId/products`

Get products for a store.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| filter | string | ❌ | Filter (trending/new) |

---

## 🗄️ DATABASE SCHEMA UPDATES

New tables added:
- `Wishlist` - User wishlists
- `UserActivity` - Activity tracking for recommendations
- `Category` - Dynamic categories
- `SearchSuggestion` - Search suggestions & trending

New fields on `Store`:
- `rating` Float (default: 3.5)
- `totalOrders` Int (default: 0)
- `category` String
- `tags` String[]

New fields on `Product`:
- `rating` Float (default: 3.5)
- `totalSold` Int (default: 0)
- `isTrending` Boolean
- `isNew` Boolean

---

## 🚀 SETUP

1. Run migration:
```bash
npx prisma migrate dev --name add_discovery_features
```

2. Seed categories:
```bash
npx prisma db seed
```

3. Start server:
```bash
npm run start:dev
```

---

## ⚡ PERFORMANCE

- All queries optimized with indexes
- Haversine calculation in SQL (not JS)
- Parallel queries where possible
- Response time < 300ms target
