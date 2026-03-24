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
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }
    if (filters.storeId) {
      whereClause += ` AND store_id = $${paramIndex++}`;
      params.push(filters.storeId);
    }
    if (filters.customerId) {
      whereClause += ` AND user_id = $${paramIndex++}`;
      params.push(filters.customerId);
    }

    const countResult = await pool.query(`SELECT COUNT(*) as count FROM orders ${whereClause}`, params);
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
}
