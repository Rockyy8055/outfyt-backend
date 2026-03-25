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

  @Get('public/debug-tables')
  async debugTables() {
    try {
      const db = getPool();
      
      // List all tables in all schemas
      const allTables = await db.query(`
        SELECT table_schema, table_name 
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `);
      
      // Check counts in all likely tables
      const counts: any = {};
      const sampleData: any = {};
      
      for (const table of allTables.rows) {
        const schema = table.table_schema;
        const tableName = table.table_name;
        const fullTableName = `"${schema}"."${tableName}"`;
        
        try {
          const countResult = await db.query(`SELECT COUNT(*) as count FROM ${fullTableName}`);
          counts[`${schema}.${tableName}`] = parseInt(countResult.rows[0]?.count || 0);
          
          if (parseInt(countResult.rows[0]?.count || 0) > 0) {
            const sampleResult = await db.query(`SELECT * FROM ${fullTableName} LIMIT 2`);
            sampleData[`${schema}.${tableName}`] = sampleResult.rows;
          }
        } catch (e: any) {
          counts[`${schema}.${tableName}`] = `Error: ${e.message}`;
        }
      }

      return {
        success: true,
        allTables: allTables.rows,
        counts,
        sampleData
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  @Get('public/admin-dashboard')
  async getDashboardStats() {
    try {
      const db = getPool();
      
      const [
        totalOrdersResult,
        totalStoresResult,
        totalUsersResult,
        totalRidersResult,
        recentOrdersResult,
      ] = await Promise.all([
        db.query('SELECT COUNT(*) as count FROM "Order"').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "Store"').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "User"').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM delivery_partners').catch(() => ({ rows: [{ count: 0 }] })),
        db.query(`
          SELECT o.id, o."orderNumber", o.status, o."totalAmount", o."paymentStatus", o."paymentMethod", o."createdAt", o."storeName"
          FROM "Order" o
          ORDER BY o."createdAt" DESC
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
            activeRiders: getCount(totalRidersResult),
            totalRiders: getCount(totalRidersResult),
            totalCustomers: getCount(totalUsersResult),
            pendingOrders: 0,
            deliveredOrders: 0,
            cancelledOrders: 0,
            openTickets: 0,
          },
          recentOrders: recentOrdersResult.rows.map((row: any) => ({
            id: row.id,
            orderNumber: row.orderNumber || (row.id ? row.id.slice(0, 8).toUpperCase() : 'N/A'),
            status: row.status,
            totalAmount: parseFloat(row.totalAmount || 0),
            paymentStatus: row.paymentStatus,
            paymentMethod: row.paymentMethod,
            createdAt: row.createdAt,
            store: row.storeName ? { name: row.storeName } : null,
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

      const countResult = await db.query('SELECT COUNT(*) as count FROM "Order"');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ordersResult = await db.query(`
        SELECT id, "orderNumber", status, "totalAmount", "paymentStatus", "paymentMethod", "createdAt", "storeName", "deliveryAddress", "customerName", "customerPhone"
        FROM "Order"
        ORDER BY "createdAt" DESC
        LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ordersResult.rows.map((row: any) => ({
          id: row.id, 
          orderNumber: row.orderNumber || (row.id ? row.id.slice(0, 8).toUpperCase() : 'N/A'),
          status: row.status, 
          totalAmount: parseFloat(row.totalAmount || 0),
          paymentStatus: row.paymentStatus, 
          paymentMethod: row.paymentMethod, 
          createdAt: row.createdAt,
          deliveryAddress: row.deliveryAddress,
          customer: { name: row.customerName, phone: row.customerPhone },
          store: row.storeName ? { name: row.storeName } : null,
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

      const countResult = await db.query('SELECT COUNT(*) as count FROM "User"');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const usersResult = await db.query(`
        SELECT id, name, email, phone, role, "createdAt"
        FROM "User" ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: usersResult.rows.map((row: any) => ({
          id: row.id, name: row.name || 'N/A', email: row.email, phone: row.phone,
          role: row.role, createdAt: row.createdAt,
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

      const countResult = await db.query('SELECT COUNT(*) as count FROM "Store"');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const storesResult = await db.query(`
        SELECT id, name, address, "isActive", "isOpen", "createdAt", "ownerId"
        FROM "Store"
        ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: storesResult.rows.map((row: any) => ({
          id: row.id, name: row.name, address: row.address,
          isActive: row.isActive, isOpen: row.isOpen, createdAt: row.createdAt,
          owner: row.ownerId ? { id: row.ownerId } : null,
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

      const countResult = await db.query('SELECT COUNT(*) as count FROM delivery_partners');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ridersResult = await db.query(`
        SELECT id, name, email, phone, "vehicleType", "vehicleNumber", "onlineStatus", "verificationStatus", "totalDeliveries", "createdAt"
        FROM delivery_partners ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ridersResult.rows.map((row: any) => ({
          id: row.id, name: row.name || 'N/A', email: row.email, phone: row.phone,
          vehicleType: row.vehicleType, vehicleNumber: row.vehicleNumber,
          isOnline: row.onlineStatus, verificationStatus: row.verificationStatus,
          totalDeliveries: row.totalDeliveries, createdAt: row.createdAt,
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
      // Check if tickets table exists
      const tableCheck = await db.query(`
        SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tickets')
      `);
      
      if (!tableCheck.rows[0]?.exists) {
        return { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
      }

      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const countResult = await db.query('SELECT COUNT(*) as count FROM tickets');
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ticketsResult = await db.query(`
        SELECT t.*, u.email as user_email
        FROM tickets t LEFT JOIN "User" u ON t.user_id = u.id
        ORDER BY t.created_at DESC LIMIT $1 OFFSET $2
      `, [limitNum, offset]);

      return {
        success: true,
        data: ticketsResult.rows,
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

      const countResult = await db.query('SELECT COUNT(*) as count FROM "Order" WHERE "paymentStatus" = $1', ['PAID']);
      const total = parseInt(countResult.rows[0]?.count || 0);

      const transactionsResult = await db.query(`
        SELECT id, "totalAmount", "paymentMethod", "createdAt", "storeName"
        FROM "Order" WHERE "paymentStatus" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3
      `, ['PAID', limitNum, offset]);

      return {
        success: true,
        data: transactionsResult.rows.map((row: any) => ({
          id: row.id, amount: parseFloat(row.totalAmount || 0), paymentMethod: row.paymentMethod, createdAt: row.createdAt,
          store: { name: row.storeName },
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
        SELECT DATE("createdAt") as date, COUNT(*) as count FROM "Order"
        WHERE "createdAt" >= $1 GROUP BY DATE("createdAt") ORDER BY date
      `, [last30Days]).catch(() => ({ rows: [] }));

      const topStoresResult = await db.query(`
        SELECT "storeName", COUNT(*) as order_count, COALESCE(SUM("totalAmount"), 0) as revenue
        FROM "Order" GROUP BY "storeName" ORDER BY revenue DESC LIMIT 5
      `).catch(() => ({ rows: [] }));

      return {
        success: true,
        data: {
          ordersByDay: ordersByDayResult.rows.map((row: any) => ({ date: row.date, count: parseInt(row.count || 0) })),
          revenueByDay: [],
          topStores: topStoresResult.rows.map((row: any) => ({
            name: row.storeName, orderCount: parseInt(row.order_count || 0), revenue: parseFloat(row.revenue || 0),
          })),
        },
      };
    } catch (error: any) {
      console.error('[Analytics Error]', error);
      return { success: false, error: error.message, data: { ordersByDay: [], revenueByDay: [], topStores: [] } };
    }
  }
}
