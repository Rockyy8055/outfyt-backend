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
      pool.query('SELECT COUNT(*) as count FROM orders'),
      pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = 'SUCCESS'"),
      pool.query('SELECT COUNT(*) as count FROM orders WHERE created_at >= $1', [today]),
      pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = 'SUCCESS' AND created_at >= $1", [today]),
      pool.query('SELECT COUNT(*) as count FROM stores WHERE is_disabled = false AND is_approved = true'),
      pool.query('SELECT COUNT(*) as count FROM stores'),
      pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'RIDER' AND is_blocked = false"),
      pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'RIDER'"),
      pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'CUSTOMER'"),
      pool.query("SELECT COUNT(*) as count FROM orders WHERE status = ANY($1)", [['PENDING', 'ACCEPTED', 'PACKING', 'READY']]),
      pool.query("SELECT COUNT(*) as count FROM orders WHERE status = 'DELIVERED'"),
      pool.query("SELECT COUNT(*) as count FROM orders WHERE status = 'CANCELLED'"),
      pool.query("SELECT COUNT(*) as count FROM tickets WHERE status = ANY($1)", [['OPEN', 'IN_PROGRESS']]),
      pool.query(`
        SELECT o.id, o.status, o.total_amount, o.payment_status, o.payment_method, o.created_at,
               u.id as user_id, u.name as user_name, u.phone as user_phone,
               s.id as store_id, s.name as store_name
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN stores s ON o.store_id = s.id
        ORDER BY o.created_at DESC
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
          orderNumber: row.id.slice(0, 8).toUpperCase(),
          status: row.status,
          totalAmount: parseFloat(row.total_amount || 0),
          paymentStatus: row.payment_status,
          paymentMethod: row.payment_method,
          createdAt: row.created_at,
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
      whereClause += ` AND o.store_id = $${paramIndex++}`;
      params.push(filters.storeId);
    }
    if (filters.customerId) {
      whereClause += ` AND o.user_id = $${paramIndex++}`;
      params.push(filters.customerId);
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM orders o ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const ordersResult = await pool.query(`
      SELECT o.id, o.status, o.total_amount, o.payment_status, o.payment_method, o.created_at,
             u.id as user_id, u.name as user_name, u.phone as user_phone,
             s.id as store_id, s.name as store_name, s.address as store_address
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN stores s ON o.store_id = s.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: ordersResult.rows.map((row: any) => ({
        id: row.id,
        orderNumber: row.id.slice(0, 8).toUpperCase(),
        status: row.status,
        totalAmount: parseFloat(row.total_amount || 0),
        paymentStatus: row.payment_status,
        paymentMethod: row.payment_method,
        createdAt: row.created_at,
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

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM users ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const usersResult = await pool.query(`
      SELECT id, name, email, phone, role, is_blocked, created_at
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
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
        isBlocked: row.is_blocked,
        createdAt: row.created_at,
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

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM stores ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const storesResult = await pool.query(`
      SELECT s.id, s.name, s.address, s.is_approved, s.is_disabled, s.created_at,
             u.id as owner_id, u.name as owner_name, u.phone as owner_phone,
             (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id) as product_count,
             (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id) as order_count
      FROM stores s
      LEFT JOIN users u ON s.owner_id = u.id
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: storesResult.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        isApproved: row.is_approved,
        isDisabled: row.is_disabled,
        createdAt: row.created_at,
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

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM users ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const ridersResult = await pool.query(`
      SELECT id, name, email, phone, is_blocked, created_at,
             (SELECT COUNT(*) FROM orders o WHERE o.rider_id = users.id) as delivery_count
      FROM users
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: ridersResult.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        isBlocked: row.is_blocked,
        createdAt: row.created_at,
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

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM tickets ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const ticketsResult = await pool.query(`
      SELECT t.id, t.subject, t.status, t.priority, t.created_at,
             u.id as user_id, u.name as user_name, u.email as user_email
      FROM tickets t
      LEFT JOIN users u ON t.user_id = u.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: ticketsResult.rows.map((row: any) => ({
        id: row.id,
        subject: row.subject,
        status: row.status,
        priority: row.priority,
        createdAt: row.created_at,
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

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM orders ${whereClause}`, params);
    const total = parseInt(countResult.rows[0]?.count || 0);

    params.push(limit, offset);
    const transactionsResult = await pool.query(`
      SELECT o.id, o.total_amount, o.payment_method, o.created_at,
             u.id as user_id, u.name as user_name,
             s.id as store_id, s.name as store_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN stores s ON o.store_id = s.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    return {
      success: true,
      data: transactionsResult.rows.map((row: any) => ({
        id: row.id,
        amount: parseFloat(row.total_amount || 0),
        paymentMethod: row.payment_method,
        createdAt: row.created_at,
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
