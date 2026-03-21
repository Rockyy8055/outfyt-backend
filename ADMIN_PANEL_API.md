# Outfyt Admin Panel API Documentation

## Overview

Complete API documentation for the Outfyt Admin Panel. All endpoints require JWT authentication with ADMIN, SUPPORT, or OPERATIONS role.

---

## Authentication & Authorization

### Roles

| Role | Access Level |
|------|-------------|
| ADMIN | Full access to all endpoints |
| SUPPORT | Tickets, users, orders (read/write) |
| OPERATIONS | Orders, riders, stores (read/write) |

### Headers

All requests require:
```
Authorization: Bearer <jwt_token>
```

---

## Order Management

### List Orders

**GET** `/admin/orders`

Query Parameters:
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by order status |
| storeId | string | Filter by store |
| customerId | string | Filter by customer |
| riderId | string | Filter by rider |
| startDate | string | Start date (ISO format) |
| endDate | string | End date (ISO format) |
| page | number | Page number (default: 1) |
| limit | number | Items per page (default: 20) |

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "orderNumber": "ORD-001",
      "status": "DELIVERED",
      "totalAmount": 1500,
      "user": { "id": "uuid", "name": "John", "phone": "+91..." },
      "store": { "id": "uuid", "name": "Fashion Store" },
      "rider": { "id": "uuid", "name": "Rider 1" },
      "items": [...],
      "createdAt": "2026-03-21T..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 500,
    "totalPages": 25
  }
}
```

### Get Order Details

**GET** `/admin/orders/:id`

Response includes: customer, store, rider, items, payment info, timeline.

### Update Order Status

**PUT** `/admin/orders/:id/status`

Request:
```json
{
  "status": "OUT_FOR_DELIVERY"
}
```

### Cancel Order

**POST** `/admin/orders/:id/cancel`

Request:
```json
{
  "reason": "Customer requested cancellation"
}
```

### Issue Refund

**POST** `/admin/orders/:id/refund`

Request:
```json
{
  "amount": 500
}
```

---

## User Management

### List Users

**GET** `/admin/users`

Query Parameters:
| Parameter | Type | Description |
|-----------|------|-------------|
| role | string | CUSTOMER, STORE, RIDER, ADMIN |
| isBlocked | boolean | Filter by blocked status |
| page | number | Page number |
| limit | number | Items per page |

### Block User

**PUT** `/admin/users/:id/block`

### Unblock User

**PUT** `/admin/users/:id/unblock`

---

## Store Management

### List Stores

**GET** `/admin/stores`

Query Parameters:
| Parameter | Type | Description |
|-----------|------|-------------|
| isApproved | boolean | Filter by approval status |
| isDisabled | boolean | Filter by disabled status |
| page | number | Page number |
| limit | number | Items per page |

### Get Store Details

**GET** `/admin/stores/:id`

Returns store info with products and order count.

### Approve Store

**PUT** `/admin/stores/:id/approve`

### Reject Store

**PUT** `/admin/stores/:id/reject`

Request:
```json
{
  "reason": "Invalid GST number"
}
```

### Disable Store

**PUT** `/admin/stores/:id/disable`

Request:
```json
{
  "reason": "Policy violation"
}
```

---

## Rider Management

### List Riders

**GET** `/admin/riders`

Query Parameters:
| Parameter | Type | Description |
|-----------|------|-------------|
| isBlocked | boolean | Filter by blocked status |
| page | number | Page number |
| limit | number | Items per page |

### Approve Rider

**PUT** `/admin/riders/:id/approve`

### Suspend Rider

**PUT** `/admin/riders/:id/suspend`

Request:
```json
{
  "reason": "Multiple delivery complaints"
}
```

---

## Support Ticket System

### Create Ticket (User)

**POST** `/support/ticket`

Headers: `Authorization: Bearer <user_token>`

Request:
```json
{
  "subject": "Order not delivered",
  "message": "My order was marked delivered but I never received it",
  "type": "LATE_DELIVERY",
  "orderId": "uuid"
}
```

Ticket Types:
- LATE_DELIVERY
- WRONG_ITEM
- DAMAGED_ITEM
- MISSING_ITEM
- PAYMENT_ISSUE
- RIDER_BEHAVIOR
- STORE_ISSUE
- OTHER

### List My Tickets (User)

**GET** `/support/tickets`

### Get Ticket Details (User)

**GET** `/support/ticket/:id`

### Reply to Ticket (User)

**POST** `/support/ticket/:id/reply`

Request:
```json
{
  "message": "Thank you for resolving this"
}
```

---

### Admin Ticket Management

**GET** `/admin/tickets`

Query Parameters:
| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | OPEN, IN_PROGRESS, RESOLVED, CLOSED |
| type | string | Ticket type |
| assignedTo | string | Admin ID |
| page | number | Page number |
| limit | number | Items per page |

**GET** `/admin/tickets/:id`

**PUT** `/admin/tickets/:id/assign`

Request:
```json
{
  "adminId": "uuid"
}
```

**PUT** `/admin/tickets/:id/status`

Request:
```json
{
  "status": "RESOLVED"
}
```

**POST** `/admin/tickets/:id/reply`

Request:
```json
{
  "message": "We have processed your refund",
  "isInternal": false
}
```

Set `isInternal: true` for internal notes (not visible to user).

---

## Analytics

**GET** `/admin/analytics`

Response:
```json
{
  "success": true,
  "data": {
    "totalOrders": 5000,
    "totalRevenue": 750000,
    "activeStores": 150,
    "activeRiders": 200,
    "pendingOrders": 25,
    "deliveredOrders": 4500,
    "openTickets": 10,
    "ordersByStatus": {
      "PENDING": 10,
      "ACCEPTED": 5,
      "PACKING": 3,
      "READY": 7,
      "DELIVERED": 4500,
      "CANCELLED": 475
    }
  }
}
```

---

## Global Search

**GET** `/admin/search?q=<query>`

Response:
```json
{
  "success": true,
  "data": {
    "orders": [...],
    "users": [...],
    "stores": [...]
  }
}
```

---

## Transactions

**GET** `/admin/transactions`

Query Parameters:
| Parameter | Type | Description |
|-----------|------|-------------|
| type | string | ORDER_PAYMENT, REFUND, RIDER_PAYOUT, STORE_PAYOUT |
| status | string | PENDING, SUCCESS, FAILED |
| page | number | Page number |
| limit | number | Items per page |

---

## Error Responses

All errors follow this format:
```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request"
}
```

Common error codes:
| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid/missing token |
| 403 | Forbidden - Insufficient role |
| 404 | Not Found - Resource not found |
| 500 | Internal Server Error |

---

## Setup Instructions

1. Run Prisma migration:
```bash
npx prisma migrate dev --name add_admin_panel
```

2. Generate Prisma client:
```bash
npx prisma generate
```

3. Create admin user:
```sql
INSERT INTO "User" (id, name, phone, role, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Admin User', '+919999999999', 'ADMIN', NOW(), NOW());
```

4. Start server:
```bash
npm run start:dev
```

---

## Security Notes

- All admin routes protected by `AdminGuard`
- Only ADMIN, SUPPORT, OPERATIONS roles can access
- All admin actions are logged for audit trail
- Store owners cannot access admin routes
- Riders cannot access admin routes
