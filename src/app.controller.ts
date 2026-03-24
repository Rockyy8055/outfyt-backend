import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  private getPool() {
    const { Pool } = require('pg');
    return new Pool({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });
  }

  // ==================== PUBLIC ADMIN ENDPOINTS ====================

  @Get('public/admin-dashboard')
  async getDashboardStats() {
    try {
      const pool = this.getPool();
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

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
        pool.query('SELECT COUNT(*) as count FROM orders').catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = 'SUCCESS'").catch(() => ({ rows: [{ total: 0 }] })),
        pool.query('SELECT COUNT(*) as count FROM orders WHERE created_at >= $1', [today]).catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = 'SUCCESS' AND created_at >= $1", [today]).catch(() => ({ rows: [{ total: 0 }] })),
        pool.query('SELECT COUNT(*) as count FROM stores WHERE is_disabled = false AND is_approved = true').catch(() => ({ rows: [{ count: 0 }] })),
        pool.query('SELECT COUNT(*) as count FROM stores').catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'RIDER' AND is_blocked = false").catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'RIDER'").catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'CUSTOMER'").catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COUNT(*) as count FROM orders WHERE status = ANY($1)", [['PENDING', 'ACCEPTED', 'PACKING', 'READY']]).catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COUNT(*) as count FROM orders WHERE status = 'DELIVERED'").catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COUNT(*) as count FROM orders WHERE status = 'CANCELLED'").catch(() => ({ rows: [{ count: 0 }] })),
        pool.query("SELECT COUNT(*) as count FROM tickets WHERE status = ANY($1)", [['OPEN', 'IN_PROGRESS']]).catch(() => ({ rows: [{ count: 0 }] })),
        pool.query(`
          SELECT o.id, o.status, o.total_amount, o.payment_status, o.payment_method, o.created_at,
                 u.id as user_id, u.name as user_name, u.phone as user_phone,
                 s.id as store_id, s.name as store_name
          FROM orders o
          LEFT JOIN users u ON o.user_id = u.id
          LEFT JOIN stores s ON o.store_id = s.id
          ORDER BY o.created_at DESC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
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
            orderNumber: row.id ? row.id.slice(0, 8).toUpperCase() : 'N/A',
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
    } catch (error: any) {
      console.error('[Dashboard Error]', error);
      return {
        success: false,
        error: error.message,
        data: {
          overview: {
            totalOrders: 0, totalRevenue: 0, todayOrders: 0, todayRevenue: 0,
            activeStores: 0, totalStores: 0, activeRiders: 0, totalRiders: 0,
            totalCustomers: 0, pendingOrders: 0, deliveredOrders: 0, cancelledOrders: 0, openTickets: 0,
          },
          recentOrders: [],
        },
      };
    }
  }

  @Get('public/admin-orders')
  async getOrders(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('status') status?: string,
  ) {
    try {
      const pool = this.getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await pool.query('SELECT COUNT(*) as count FROM orders');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ordersResult = await pool.query(`
        SELECT o.id, o.status, o.total_amount, o.payment_status, o.payment_method, o.created_at,
               u.id as user_id, u.name as user_name, u.phone as user_phone,
               s.id as store_id, s.name as store_name, s.address as store_address
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN stores s ON o.store_id = s.id
        ORDER BY o.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ordersResult.rows.map((row: any) => ({
          id: row.id,
          orderNumber: row.id ? row.id.slice(0, 8).toUpperCase() : 'N/A',
          status: row.status,
          totalAmount: parseFloat(row.total_amount || 0),
          paymentStatus: row.payment_status,
          paymentMethod: row.payment_method,
          createdAt: row.created_at,
          user: row.user_id ? { id: row.user_id, name: row.user_name, phone: row.user_phone } : null,
          store: row.store_id ? { id: row.store_id, name: row.store_name, address: row.store_address } : null,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Orders Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-users')
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('role') role?: string,
  ) {
    try {
      const pool = this.getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await pool.query('SELECT COUNT(*) as count FROM users');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const usersResult = await pool.query(`
        SELECT id, name, email, phone, role, is_blocked, created_at
        FROM users
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: usersResult.rows.map((row: any) => ({
          id: row.id, name: row.name, email: row.email, phone: row.phone,
          role: row.role, isBlocked: row.is_blocked, createdAt: row.created_at,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Users Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-stores')
  async getStores(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    try {
      const pool = this.getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await pool.query('SELECT COUNT(*) as count FROM stores');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const storesResult = await pool.query(`
        SELECT s.id, s.name, s.address, s.is_approved, s.is_disabled, s.created_at,
               u.id as owner_id, u.name as owner_name, u.phone as owner_phone
        FROM stores s
        LEFT JOIN users u ON s.owner_id = u.id
        ORDER BY s.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: storesResult.rows.map((row: any) => ({
          id: row.id, name: row.name, address: row.address,
          isApproved: row.is_approved, isDisabled: row.is_disabled, createdAt: row.created_at,
          owner: row.owner_id ? { id: row.owner_id, name: row.owner_name, phone: row.owner_phone } : null,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Stores Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-riders')
  async getRiders(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    try {
      const pool = this.getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'RIDER'");
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ridersResult = await pool.query(`
        SELECT id, name, email, phone, is_blocked, created_at
        FROM users
        WHERE role = 'RIDER'
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ridersResult.rows.map((row: any) => ({
          id: row.id, name: row.name, email: row.email, phone: row.phone,
          isBlocked: row.is_blocked, createdAt: row.created_at,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Riders Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-tickets')
  async getTickets(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    try {
      const pool = this.getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await pool.query('SELECT COUNT(*) as count FROM tickets');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ticketsResult = await pool.query(`
        SELECT t.id, t.subject, t.status, t.priority, t.created_at,
               u.id as user_id, u.name as user_name, u.email as user_email
        FROM tickets t
        LEFT JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ticketsResult.rows.map((row: any) => ({
          id: row.id, subject: row.subject, status: row.status, priority: row.priority,
          createdAt: row.created_at,
          user: row.user_id ? { id: row.user_id, name: row.user_name, email: row.user_email } : null,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Tickets Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-transactions')
  async getTransactions(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    try {
      const pool = this.getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await pool.query("SELECT COUNT(*) as count FROM orders WHERE payment_status = 'SUCCESS'");
      const total = parseInt(countResult.rows[0]?.count || 0);

      const transactionsResult = await pool.query(`
        SELECT o.id, o.total_amount, o.payment_method, o.created_at,
               u.id as user_id, u.name as user_name,
               s.id as store_id, s.name as store_name
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN stores s ON o.store_id = s.id
        WHERE o.payment_status = 'SUCCESS'
        ORDER BY o.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: transactionsResult.rows.map((row: any) => ({
          id: row.id, amount: parseFloat(row.total_amount || 0),
          paymentMethod: row.payment_method, createdAt: row.created_at,
          user: row.user_id ? { id: row.user_id, name: row.user_name } : null,
          store: row.store_id ? { id: row.store_id, name: row.store_name } : null,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Transactions Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-analytics')
  async getAnalytics() {
    try {
      const pool = this.getPool();
      
      const last30Days = new Date();
      last30Days.setDate(last30Days.getDate() - 30);

      const ordersByDayResult = await pool.query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM orders
        WHERE created_at >= $1
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [last30Days]).catch(() => ({ rows: [] }));

      const revenueByDayResult = await pool.query(`
        SELECT DATE(created_at) as date, COALESCE(SUM(total_amount), 0) as total
        FROM orders
        WHERE payment_status = 'SUCCESS' AND created_at >= $1
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [last30Days]).catch(() => ({ rows: [] }));

      const topStoresResult = await pool.query(`
        SELECT s.id, s.name, COUNT(o.id) as order_count, COALESCE(SUM(o.total_amount), 0) as revenue
        FROM stores s
        LEFT JOIN orders o ON s.id = o.store_id
        GROUP BY s.id, s.name
        ORDER BY revenue DESC
        LIMIT 5
      `).catch(() => ({ rows: [] }));

      return {
        success: true,
        data: {
          ordersByDay: ordersByDayResult.rows.map((row: any) => ({
            date: row.date, count: parseInt(row.count || 0),
          })),
          revenueByDay: revenueByDayResult.rows.map((row: any) => ({
            date: row.date, revenue: parseFloat(row.total || 0),
          })),
          topStores: topStoresResult.rows.map((row: any) => ({
            id: row.id, name: row.name,
            orderCount: parseInt(row.order_count || 0),
            revenue: parseFloat(row.revenue || 0),
          })),
        },
      };
    } catch (error: any) {
      console.error('[Analytics Error]', error);
      return { success: false, error: error.message, data: { ordersByDay: [], revenueByDay: [], topStores: [] } };
    }
  }
}
