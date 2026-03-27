import { Injectable } from '@nestjs/common';

@Injectable()
export class DirectDbService {
  private getPool() {
    const { Pool } = require('pg');
    return new Pool({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });
  }

  async getDashboardStats() {
    const pool = this.getPool();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const [
      totalOrdersResult,
      totalRevenueResult,
      todayOrdersResult,
      todayRevenueResult,
      activeStoresResult,
      totalStoresResult,
      activeRidersResult,
      totalRidersResult,
      totalCustomersResult,
      pendingOrdersResult,
      deliveredOrdersResult,
      cancelledOrdersResult,
      openTicketsResult,
      recentOrdersResult,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM "Order"'),
      pool.query('SELECT COALESCE(SUM("totalAmount"), 0) as total FROM "Order" WHERE "paymentStatus" = $1', ['SUCCESS']),
      pool.query('SELECT COUNT(*) as count FROM "Order" WHERE "createdAt" >= $1', [today]),
      pool.query('SELECT COALESCE(SUM("totalAmount"), 0) as total FROM "Order" WHERE "paymentStatus" = $1 AND "createdAt" >= $2', ['SUCCESS', today]),
      pool.query('SELECT COUNT(*) as count FROM "Store" WHERE "isDisabled" = false AND "isApproved" = true'),
      pool.query('SELECT COUNT(*) as count FROM "Store"'),
      pool.query('SELECT COUNT(*) as count FROM "User" WHERE role = $1 AND "isBlocked" = false', ['RIDER']),
      pool.query('SELECT COUNT(*) as count FROM "User" WHERE role = $1', ['RIDER']),
      pool.query('SELECT COUNT(*) as count FROM "User" WHERE role = $1', ['CUSTOMER']),
      pool.query('SELECT COUNT(*) as count FROM "Order" WHERE status = ANY($1)', [['PENDING', 'ACCEPTED', 'PACKING', 'READY']]),
      pool.query('SELECT COUNT(*) as count FROM "Order" WHERE status = $1', ['DELIVERED']),
      pool.query('SELECT COUNT(*) as count FROM "Order" WHERE status = $1', ['CANCELLED']),
      pool.query('SELECT COUNT(*) as count FROM "Ticket" WHERE status = ANY($1)', [['OPEN', 'IN_PROGRESS']]),
      pool.query(`
        SELECT o.id, o.status, o."totalAmount", o."paymentStatus", o."paymentMethod", o."createdAt",
               o."customerName", o."customerPhone", o."orderNumber", o."storeName",
               u.id as user_id, u.name as user_name, u.phone as user_phone,
               s.id as store_id, s.name as store_name
        FROM "Order" o
        LEFT JOIN "User" u ON o."userId" = u.id
        LEFT JOIN "Store" s ON o."storeId" = s.id
        ORDER BY o."createdAt" DESC
        LIMIT 10
      `),
    ]);

    const getCount = (result: any) => parseInt(result.rows[0]?.count || 0);
    const getSum = (result: any) => parseFloat(result.rows[0]?.total || 0);

    return {
      success: true,
      data: {
        overview: {
          totalOrders: getCount(totalOrdersResult),
          totalRevenue: getSum(totalRevenueResult),
          todayOrders: getCount(todayOrdersResult),
          todayRevenue: getSum(todayRevenueResult),
          activeStores: getCount(activeStoresResult),
          totalStores: getCount(totalStoresResult),
          activeRiders: getCount(activeRidersResult),
          totalRiders: getCount(totalRidersResult),
          totalCustomers: getCount(totalCustomersResult),
          pendingOrders: getCount(pendingOrdersResult),
          deliveredOrders: getCount(deliveredOrdersResult),
          cancelledOrders: getCount(cancelledOrdersResult),
          openTickets: getCount(openTicketsResult),
        },
        recentOrders: recentOrdersResult.rows.map((row: any) => ({
          id: row.id,
          orderNumber: row.orderNumber || row.id.slice(0, 8).toUpperCase(),
          status: row.status,
          totalAmount: parseFloat(row.totalAmount || 0),
          paymentStatus: row.paymentStatus,
          paymentMethod: row.paymentMethod,
          createdAt: row.createdAt,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          storeName: row.storeName,
          user: row.user_id ? {
            id: row.user_id,
            name: row.user_name,
            phone: row.user_phone,
          } : null,
          store: row.store_id ? {
            id: row.store_id,
            name: row.store_name,
          } : null,
        })),
      },
    };
  }

  async getOrders(filters: any) {
    const pool = this.getPool();
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.status) {
      whereClause += ` AND o.status = $${paramIndex++}`;
      params.push(filters.status);
    }
    if (filters.storeId) {
      whereClause += ` AND o."storeId" = $${paramIndex++}`;
      params.push(filters.storeId);
    }
    if (filters.customerId) {
      whereClause += ` AND o."userId" = $${paramIndex++}`;
      params.push(filters.customerId);
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "Order" o ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const ordersResult = await pool.query(`
      SELECT o.id, o.status, o."totalAmount", o."paymentStatus", o."paymentMethod", o."createdAt",
             o."orderNumber", o."customerName", o."customerPhone", o."storeName", o."deliveryAddress",
             u.id as user_id, u.name as user_name, u.phone as user_phone,
             s.id as store_id, s.name as store_name, s.address as store_address
      FROM "Order" o
      LEFT JOIN "User" u ON o."userId" = u.id
      LEFT JOIN "Store" s ON o."storeId" = s.id
      ${whereClause}
      ORDER BY o."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: ordersResult.rows.map((row: any) => ({
        id: row.id,
        orderNumber: row.orderNumber || row.id.slice(0, 8).toUpperCase(),
        status: row.status,
        totalAmount: parseFloat(row.totalAmount || 0),
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod,
        createdAt: row.createdAt,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        storeName: row.storeName,
        deliveryAddress: row.deliveryAddress,
        user: row.user_id ? {
          id: row.user_id,
          name: row.user_name,
          phone: row.user_phone,
        } : null,
        store: row.store_id ? {
          id: row.store_id,
          name: row.store_name,
          address: row.store_address,
        } : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUsers(filters: any) {
    const pool = this.getPool();
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.role) {
      whereClause += ` AND role = $${paramIndex++}`;
      params.push(filters.role);
    }
    if (filters.search) {
      whereClause += ` AND (name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "User" ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const usersResult = await pool.query(`
      SELECT id, name, email, phone, role, "isBlocked", "createdAt"
      FROM "User"
      ${whereClause}
      ORDER BY "createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: usersResult.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        isBlocked: row.isBlocked,
        createdAt: row.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getStores(filters: any) {
    const pool = this.getPool();
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.isApproved !== undefined) {
      whereClause += ` AND is_approved = $${paramIndex++}`;
      params.push(filters.isApproved === 'true');
    }
    if (filters.isDisabled !== undefined) {
      whereClause += ` AND is_disabled = $${paramIndex++}`;
      params.push(filters.isDisabled === 'true');
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "Store" ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const storesResult = await pool.query(`
      SELECT s.id, s.name, s.address, s."isApproved", s."isDisabled", s."createdAt",
             u.id as owner_id, u.name as owner_name, u.phone as owner_phone,
             (SELECT COUNT(*) FROM "Product" p WHERE p."storeId" = s.id) as product_count,
             (SELECT COUNT(*) FROM "Order" o WHERE o."storeId" = s.id) as order_count
      FROM "Store" s
      LEFT JOIN "User" u ON s."ownerId" = u.id
      ${whereClause}
      ORDER BY s."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: storesResult.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        isApproved: row.isApproved,
        isDisabled: row.isDisabled,
        createdAt: row.createdAt,
        owner: row.owner_id ? {
          id: row.owner_id,
          name: row.owner_name,
          phone: row.owner_phone,
        } : null,
        productCount: parseInt(row.product_count || 0),
        orderCount: parseInt(row.order_count || 0),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getRiders(filters: any) {
    const pool = this.getPool();
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = "WHERE role = 'RIDER'";
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.isBlocked !== undefined) {
      whereClause += ` AND is_blocked = $${paramIndex++}`;
      params.push(filters.isBlocked === 'true');
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "User" ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const ridersResult = await pool.query(`
      SELECT id, name, email, phone, "isBlocked", "createdAt",
             (SELECT COUNT(*) FROM "Order" o WHERE o."riderId" = "User".id) as delivery_count
      FROM "User"
      ${whereClause}
      ORDER BY "createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: ridersResult.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        isBlocked: row.isBlocked,
        createdAt: row.createdAt,
        deliveryCount: parseInt(row.delivery_count || 0),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTickets(filters: any) {
    const pool = this.getPool();
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "Ticket" ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const ticketsResult = await pool.query(`
      SELECT t.id, t.subject, t.status, t.priority, t."createdAt",
             u.id as user_id, u.name as user_name, u.email as user_email
      FROM "Ticket" t
      LEFT JOIN "User" u ON t."userId" = u.id
      ${whereClause}
      ORDER BY t."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: ticketsResult.rows.map((row: any) => ({
        id: row.id,
        subject: row.subject,
        status: row.status,
        priority: row.priority,
        createdAt: row.createdAt,
        user: row.user_id ? {
          id: row.user_id,
          name: row.user_name,
          email: row.user_email,
        } : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTransactions(filters: any) {
    const pool = this.getPool();
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = "WHERE payment_status = 'SUCCESS'";
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM "Order" ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const transactionsResult = await pool.query(`
      SELECT o.id, o."totalAmount", o."paymentMethod", o."createdAt",
             u.id as user_id, u.name as user_name,
             s.id as store_id, s.name as store_name
      FROM "Order" o
      LEFT JOIN "User" u ON o."userId" = u.id
      LEFT JOIN "Store" s ON o."storeId" = s.id
      ${whereClause}
      ORDER BY o."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: transactionsResult.rows.map((row: any) => ({
        id: row.id,
        amount: parseFloat(row.totalAmount || 0),
        paymentMethod: row.paymentMethod,
        createdAt: row.createdAt,
        user: row.user_id ? {
          id: row.user_id,
          name: row.user_name,
        } : null,
        store: row.store_id ? {
          id: row.store_id,
          name: row.store_name,
        } : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getAnalytics() {
    const pool = this.getPool();
    
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const [
      ordersByDayResult,
      revenueByDayResult,
      topStoresResult,
      topProductsResult,
    ] = await Promise.all([
      pool.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM orders
        WHERE created_at >= $1
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [last30Days]),
      pool.query(`
        SELECT DATE(created_at) as date, COALESCE(SUM(total_amount), 0) as total
        FROM orders
        WHERE payment_status = 'SUCCESS' AND created_at >= $1
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [last30Days]),
      pool.query(`
        SELECT s.id, s.name, COUNT(o.id) as order_count, COALESCE(SUM(o.total_amount), 0) as revenue
        FROM stores s
        LEFT JOIN orders o ON s.id = o.store_id
        GROUP BY s.id, s.name
        ORDER BY revenue DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT p.id, p.name, COUNT(oi.id) as order_count, COALESCE(SUM(oi.quantity * oi.unit_price), 0) as revenue
        FROM products p
        LEFT JOIN order_items oi ON p.id = oi.product_id
        GROUP BY p.id, p.name
        ORDER BY revenue DESC
        LIMIT 5
      `),
    ]);

    return {
      success: true,
      data: {
        ordersByDay: ordersByDayResult.rows.map((row: any) => ({
          date: row.date,
          count: parseInt(row.count || 0),
        })),
        revenueByDay: revenueByDayResult.rows.map((row: any) => ({
          date: row.date,
          revenue: parseFloat(row.total || 0),
        })),
        topStores: topStoresResult.rows.map((row: any) => ({
          id: row.id,
          name: row.name,
          orderCount: parseInt(row.order_count || 0),
          revenue: parseFloat(row.revenue || 0),
        })),
        topProducts: topProductsResult.rows.map((row: any) => ({
          id: row.id,
          name: row.name,
          orderCount: parseInt(row.order_count || 0),
          revenue: parseFloat(row.revenue || 0),
        })),
      },
    };
  }
}
