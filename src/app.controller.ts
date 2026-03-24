import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { Pool } from 'pg';

// Singleton pool instance
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    console.log('[DB] Creating pool with connection string:', connectionString ? 'set' : 'missing');
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // ==================== PUBLIC ADMIN ENDPOINTS ====================

  @Get('public/admin-dashboard')
  async getDashboardStats() {
    try {
      const db = getPool();
      
      const [
        totalOrdersResult,
        totalStoresResult,
        totalUsersResult,
        recentOrdersResult,
      ] = await Promise.all([
        db.query('SELECT COUNT(*) as count FROM orders').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM stores').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM users').catch(() => ({ rows: [{ count: 0 }] })),
        db.query(`
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

      return {
        success: true,
        data: {
          overview: {
            totalOrders: getCount(totalOrdersResult),
            totalRevenue: 0,
            todayOrders: 0,
            todayRevenue: 0,
            activeStores: getCount(totalStoresResult),
            totalStores: getCount(totalStoresResult),
            activeRiders: 0,
            totalRiders: 0,
            totalCustomers: getCount(totalUsersResult),
            pendingOrders: 0,
            deliveredOrders: 0,
            cancelledOrders: 0,
            openTickets: 0,
          },
          recentOrders: recentOrdersResult.rows.map((row: any) => ({
            id: row.id,
            orderNumber: row.id ? row.id.slice(0, 8).toUpperCase() : 'N/A',
            status: row.status,
            totalAmount: parseFloat(row.total_amount || 0),
            paymentStatus: row.payment_status,
            paymentMethod: row.payment_method,
            createdAt: row.created_at,
            user: row.user_id ? { id: row.user_id, name: row.user_name, phone: row.user_phone } : null,
            store: row.store_id ? { id: row.store_id, name: row.store_name } : null,
          })),
        },
      };
    } catch (error: any) {
      console.error('[Dashboard Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  @Get('public/admin-orders')
  async getOrders(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await db.query('SELECT COUNT(*) as count FROM orders');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ordersResult = await db.query(`
        SELECT o.*, 
               u.id as user_id, u.name as user_name, u.phone as user_phone,
               s.id as store_id, s.name as store_name, s.address as store_address
        FROM orders o
        LEFT JOIN users u ON o."userId" = u.id
        LEFT JOIN stores s ON o."storeId" = s.id
        ORDER BY o."createdAt" DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ordersResult.rows.map((row: any) => ({
          id: row.id, orderNumber: row.orderNumber || (row.id ? row.id.slice(0, 8).toUpperCase() : 'N/A'),
          status: row.status, totalAmount: parseFloat(row.totalAmount || row.total_amount || 0),
          paymentStatus: row.paymentStatus || row.payment_status, 
          paymentMethod: row.paymentMethod || row.payment_method, 
          createdAt: row.createdAt || row.created_at,
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
  async getUsers(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await db.query('SELECT COUNT(*) as count FROM users');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const usersResult = await db.query(`
        SELECT id, name, email, phone, role, "isBlocked", "createdAt"
        FROM users ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: usersResult.rows.map((row: any) => ({
          id: row.id, name: row.name, email: row.email, phone: row.phone,
          role: row.role, isBlocked: row.isBlocked, createdAt: row.createdAt,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Users Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-stores')
  async getStores(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await db.query('SELECT COUNT(*) as count FROM stores');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const storesResult = await db.query(`
        SELECT s.id, s.name, s.address, s."isApproved", s."isDisabled", s."createdAt",
               u.id as owner_id, u.name as owner_name, u.phone as owner_phone
        FROM stores s LEFT JOIN users u ON s."ownerId" = u.id
        ORDER BY s."createdAt" DESC LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: storesResult.rows.map((row: any) => ({
          id: row.id, name: row.name, address: row.address,
          isApproved: row.isApproved, isDisabled: row.isDisabled, createdAt: row.createdAt,
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
  async getRiders(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await db.query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['RIDER']);
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ridersResult = await db.query(`
        SELECT id, name, email, phone, "isBlocked", "createdAt"
        FROM users WHERE role = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3
      `, ['RIDER', limitNum, offset]);

      return {
        success: true,
        data: ridersResult.rows.map((row: any) => ({
          id: row.id, name: row.name, email: row.email, phone: row.phone,
          isBlocked: row.isBlocked, createdAt: row.createdAt,
        })),
        pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
      };
    } catch (error: any) {
      console.error('[Riders Error]', error);
      return { success: false, error: error.message, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
  }

  @Get('public/admin-tickets')
  async getTickets(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await db.query('SELECT COUNT(*) as count FROM tickets');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ticketsResult = await db.query(`
        SELECT t.id, t.subject, t.status, t.priority, t."createdAt",
               u.id as user_id, u.name as user_name, u.email as user_email
        FROM tickets t LEFT JOIN users u ON t."userId" = u.id
        ORDER BY t."createdAt" DESC LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ticketsResult.rows.map((row: any) => ({
          id: row.id, subject: row.subject, status: row.status, priority: row.priority, createdAt: row.createdAt,
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
  async getTransactions(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await db.query('SELECT COUNT(*) as count FROM orders WHERE "paymentStatus" = $1', ['SUCCESS']);
      const total = parseInt(countResult.rows[0]?.count || 0);

      const transactionsResult = await db.query(`
        SELECT o.id, o."totalAmount", o."paymentMethod", o."createdAt",
               u.id as user_id, u.name as user_name, s.id as store_id, s.name as store_name
        FROM orders o LEFT JOIN users u ON o."userId" = u.id LEFT JOIN stores s ON o."storeId" = s.id
        WHERE o."paymentStatus" = $1 ORDER BY o."createdAt" DESC LIMIT $2 OFFSET $3
      `, ['SUCCESS', limitNum, offset]);

      return {
        success: true,
        data: transactionsResult.rows.map((row: any) => ({
          id: row.id, amount: parseFloat(row.totalAmount || 0), paymentMethod: row.paymentMethod, createdAt: row.createdAt,
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
      const db = getPool();
      const last30Days = new Date();
      last30Days.setDate(last30Days.getDate() - 30);

      const ordersByDayResult = await db.query(`
        SELECT DATE("createdAt") as date, COUNT(*) as count FROM orders
        WHERE "createdAt" >= $1 GROUP BY DATE("createdAt") ORDER BY date
      `, [last30Days]).catch(() => ({ rows: [] }));

      const topStoresResult = await db.query(`
        SELECT s.id, s.name, COUNT(o.id) as order_count, COALESCE(SUM(o."totalAmount"), 0) as revenue
        FROM stores s LEFT JOIN orders o ON s.id = o."storeId"
        GROUP BY s.id, s.name ORDER BY revenue DESC LIMIT 5
      `).catch(() => ({ rows: [] }));

      return {
        success: true,
        data: {
          ordersByDay: ordersByDayResult.rows.map((row: any) => ({ date: row.date, count: parseInt(row.count || 0) })),
          revenueByDay: [],
          topStores: topStoresResult.rows.map((row: any) => ({
            id: row.id, name: row.name, orderCount: parseInt(row.order_count || 0), revenue: parseFloat(row.revenue || 0),
          })),
        },
      };
    } catch (error: any) {
      console.error('[Analytics Error]', error);
      return { success: false, error: error.message, data: { ordersByDay: [], revenueByDay: [], topStores: [] } };
    }
  }
}
