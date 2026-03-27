import { Controller, Get, Post, Query, Body, Param } from '@nestjs/common';
import { AppService } from './app.service';
import { Pool } from 'pg';
import { createRazorpayOrder, verifyPaymentSignature } from './services/payment.service';
import { calculateOrderFinancials } from './utils/pricing.util';

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
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      const [
        totalOrdersResult,
        totalRevenueResult,
        todayOrdersResult,
        todayRevenueResult,
        totalStoresResult,
        totalUsersResult,
        totalRidersResult,
        pendingOrdersResult,
        deliveredOrdersResult,
        cancelledOrdersResult,
        recentOrdersResult,
      ] = await Promise.all([
        db.query('SELECT COUNT(*) as count FROM "Order"').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COALESCE(SUM("totalAmount"), 0) as total FROM "Order" WHERE status = $1', ['DELIVERED']).catch(() => ({ rows: [{ total: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "Order" WHERE DATE("createdAt") = $1', [today]).catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COALESCE(SUM("totalAmount"), 0) as total FROM "Order" WHERE DATE("createdAt") = $1 AND status = $2', [today, 'DELIVERED']).catch(() => ({ rows: [{ total: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "Store"').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "User"').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM delivery_partners').catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "Order" WHERE status = $1', ['PENDING']).catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "Order" WHERE status = $1', ['DELIVERED']).catch(() => ({ rows: [{ count: 0 }] })),
        db.query('SELECT COUNT(*) as count FROM "Order" WHERE status = $1', ['CANCELLED']).catch(() => ({ rows: [{ count: 0 }] })),
        db.query(`
          SELECT o.id, o."orderNumber", o.status, o."totalAmount", o."paymentStatus", o."paymentMethod", o."createdAt", o."storeName"
          FROM "Order" o
          ORDER BY o."createdAt" DESC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
      ]);

      const getCount = (result: any) => parseInt(result.rows[0]?.count || 0);
      const getAmount = (result: any) => parseFloat(result.rows[0]?.total || 0);

      return {
        success: true,
        data: {
          overview: {
            totalOrders: getCount(totalOrdersResult),
            totalRevenue: getAmount(totalRevenueResult),
            todayOrders: getCount(todayOrdersResult),
            todayRevenue: getAmount(todayRevenueResult),
            activeStores: getCount(totalStoresResult),
            totalStores: getCount(totalStoresResult),
            activeRiders: getCount(totalRidersResult),
            totalRiders: getCount(totalRidersResult),
            totalCustomers: getCount(totalUsersResult),
            pendingOrders: getCount(pendingOrdersResult),
            deliveredOrders: getCount(deliveredOrdersResult),
            cancelledOrders: getCount(cancelledOrdersResult),
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
    @Query('search') search: string = '',
    @Query('status') status: string = '',
  ) {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE clause for search and status filter
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (search) {
        const searchPattern = `%${search}%`;
        conditions.push(`("orderNumber" ILIKE $${paramIndex} OR "customerName" ILIKE $${paramIndex} OR "customerPhone" ILIKE $${paramIndex} OR id ILIKE $${paramIndex} OR "storeName" ILIKE $${paramIndex})`);
        params.push(searchPattern);
        paramIndex++;
      }

      if (status && status !== 'all') {
        conditions.push(`status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count with filters
      const countResult = await db.query(`SELECT COUNT(*) as count FROM "Order" ${whereClause}`, params);
      const total = parseInt(countResult.rows[0]?.count || 0);

      // Get orders with filters
      const ordersResult = await db.query(`
        SELECT id, "orderNumber", status, "totalAmount", "paymentStatus", "paymentMethod", "createdAt", "storeName", "deliveryAddress", "customerName", "customerPhone"
        FROM "Order"
        ${whereClause}
        ORDER BY "createdAt" DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...params, limitNum, offset]);

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
  async getUsers(@Query('page') page: string = '1', @Query('limit') limit: string = '20', @Query('search') search: string = '') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE clause for search
      let whereClause = '';
      let params: any[] = [];
      if (search) {
        const searchPattern = `%${search}%`;
        whereClause = `WHERE (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR id ILIKE $1)`;
        params = [searchPattern];
      }

      const countResult = await db.query(`SELECT COUNT(*) as count FROM "User" ${whereClause}`, params);
      const total = parseInt(countResult.rows[0]?.count || 0);

      const usersResult = await db.query(`
        SELECT id, name, email, phone, role, "createdAt"
        FROM "User" ${whereClause} ORDER BY "createdAt" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limitNum, offset]);

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
  async getStores(@Query('page') page: string = '1', @Query('limit') limit: string = '20', @Query('search') search: string = '') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE clause for search
      let whereClause = '';
      let params: any[] = [];
      if (search) {
        const searchPattern = `%${search}%`;
        whereClause = `WHERE (name ILIKE $1 OR address ILIKE $1 OR id ILIKE $1)`;
        params = [searchPattern];
      }

      const countResult = await db.query(`SELECT COUNT(*) as count FROM "Store" ${whereClause}`, params);
      const total = parseInt(countResult.rows[0]?.count || 0);

      const storesResult = await db.query(`
        SELECT id, name, address, "isApproved", "isDisabled", "isOnline", "createdAt", "ownerId"
        FROM "Store" ${whereClause}
        ORDER BY "createdAt" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limitNum, offset]);

      return {
        success: true,
        data: storesResult.rows.map((row: any) => ({
          id: row.id, name: row.name, address: row.address,
          isApproved: row.isApproved, isDisabled: row.isDisabled, isOnline: row.isOnline, createdAt: row.createdAt,
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
  async getRiders(@Query('page') page: string = '1', @Query('limit') limit: string = '20', @Query('search') search: string = '') {
    try {
      const db = getPool();
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE clause for search
      let whereClause = '';
      let params: any[] = [];
      if (search) {
        const searchPattern = `%${search}%`;
        whereClause = `WHERE (name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR id ILIKE $1)`;
        params = [searchPattern];
      }

      const countResult = await db.query(`SELECT COUNT(*) as count FROM delivery_partners ${whereClause}`, params);
      const total = parseInt(countResult.rows[0]?.count || 0);

      const ridersResult = await db.query(`
        SELECT id, name, email, phone, vehicle_type, vehicle_number, online_status, verification_status, total_deliveries, created_at
        FROM delivery_partners ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limitNum, offset]);

      return {
        success: true,
        data: ridersResult.rows.map((row: any) => ({
          id: row.id, name: row.name || 'N/A', email: row.email, phone: row.phone,
          vehicleType: row.vehicle_type, vehicleNumber: row.vehicle_number,
          isOnline: row.online_status, verificationStatus: row.verification_status,
          totalDeliveries: row.total_deliveries, createdAt: row.created_at,
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

  // ==================== RIDER ANALYTICS ENDPOINTS ====================

  @Get('public/rider-analytics/:riderId')
  async getRiderAnalytics(@Query('riderId') riderId: string) {
    try {
      const db = getPool();
      
      // Get rider wallet
      const walletResult = await db.query(`
        SELECT * FROM "RiderWallet" WHERE "riderId" = $1
      `, [riderId]);
      
      const wallet = walletResult.rows[0] || {
        totalEarnings: 0,
        withdrawableBalance: 0,
        todayEarnings: 0,
        weeklyEarnings: 0,
        totalDeliveries: 0,
      };

      // Get recent deliveries with earnings
      const deliveriesResult = await db.query(`
        SELECT o.id, o."orderNumber", o."riderEarning", o."distanceKm", o."createdAt", s.name as "storeName"
        FROM "Order" o
        JOIN "Store" s ON o."storeId" = s.id
        WHERE o."riderId" = $1 AND o.status = 'DELIVERED'
        ORDER BY o."createdAt" DESC
        LIMIT 20
      `, [riderId]).catch(() => ({ rows: [] }));

      return {
        success: true,
        data: {
          totalEarnings: parseFloat(wallet.totalEarnings || 0),
          withdrawableBalance: parseFloat(wallet.withdrawableBalance || 0),
          todayEarnings: parseFloat(wallet.todayEarnings || 0),
          weeklyEarnings: parseFloat(wallet.weeklyEarnings || 0),
          totalDeliveries: parseInt(wallet.totalDeliveries || 0),
          recentDeliveries: deliveriesResult.rows.map((row: any) => ({
            orderId: row.id,
            orderNumber: row.orderNumber,
            earning: parseFloat(row.riderEarning || 0),
            distanceKm: parseFloat(row.distanceKm || 0),
            storeName: row.storeName,
            date: row.createdAt,
          })),
        },
      };
    } catch (error: any) {
      console.error('[Rider Analytics Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  @Get('public/rider-wallet/:riderId')
  async getRiderWallet(@Query('riderId') riderId: string) {
    try {
      const db = getPool();
      
      const walletResult = await db.query(`
        SELECT * FROM "RiderWallet" WHERE "riderId" = $1
      `, [riderId]);
      
      const wallet = walletResult.rows[0];

      if (!wallet) {
        // Create wallet if doesn't exist
        const newWallet = await db.query(`
          INSERT INTO "RiderWallet" ("id", "riderId", "totalEarnings", "withdrawableBalance", "todayEarnings", "weeklyEarnings", "totalDeliveries")
          VALUES (gen_random_uuid(), $1, 0, 0, 0, 0, 0)
          RETURNING *
        `, [riderId]);
        return { success: true, data: newWallet.rows[0] };
      }

      return {
        success: true,
        data: {
          totalEarnings: parseFloat(wallet.totalEarnings || 0),
          withdrawableBalance: parseFloat(wallet.withdrawableBalance || 0),
          pendingBalance: parseFloat(wallet.pendingBalance || 0),
          todayEarnings: parseFloat(wallet.todayEarnings || 0),
          weeklyEarnings: parseFloat(wallet.weeklyEarnings || 0),
          totalDeliveries: parseInt(wallet.totalDeliveries || 0),
        },
      };
    } catch (error: any) {
      console.error('[Rider Wallet Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  // ==================== STORE ANALYTICS ENDPOINTS ====================

  @Get('public/store-analytics/:storeId')
  async getStoreAnalytics(@Query('storeId') storeId: string) {
    try {
      const db = getPool();
      
      // Get store wallet
      const walletResult = await db.query(`
        SELECT * FROM "StoreWallet" WHERE "storeId" = $1
      `, [storeId]);
      
      const wallet = walletResult.rows[0] || {
        totalEarnings: 0,
        withdrawableBalance: 0,
      };

      // Get order stats
      const statsResult = await db.query(`
        SELECT 
          COUNT(*) as "totalOrders",
          COALESCE(SUM("productAmount"), 0) as "totalRevenue",
          COALESCE(SUM("commissionAmount"), 0) as "totalCommission",
          COALESCE(SUM("storeEarning"), 0) as "totalStoreEarning"
        FROM "Order" WHERE "storeId" = $1
      `, [storeId]).catch(() => ({ rows: [{ totalOrders: 0, totalRevenue: 0, totalCommission: 0, totalStoreEarning: 0 }] }));

      const stats = statsResult.rows[0];

      // Get recent orders with earnings
      const ordersResult = await db.query(`
        SELECT id, "orderNumber", "productAmount", "commissionAmount", "storeEarning", "createdAt", status
        FROM "Order" WHERE "storeId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 10
      `, [storeId]).catch(() => ({ rows: [] }));

      return {
        success: true,
        data: {
          totalEarnings: parseFloat(wallet.totalEarnings || 0),
          withdrawableBalance: parseFloat(wallet.withdrawableBalance || 0),
          totalOrders: parseInt(stats.totalOrders || 0),
          totalRevenue: parseFloat(stats.totalRevenue || 0),
          totalCommission: parseFloat(stats.totalCommission || 0),
          totalStoreEarning: parseFloat(stats.totalStoreEarning || 0),
          recentOrders: ordersResult.rows.map((row: any) => ({
            orderId: row.id,
            orderNumber: row.orderNumber,
            productAmount: parseFloat(row.productAmount || 0),
            commissionAmount: parseFloat(row.commissionAmount || 0),
            storeEarning: parseFloat(row.storeEarning || 0),
            status: row.status,
            date: row.createdAt,
          })),
        },
      };
    } catch (error: any) {
      console.error('[Store Analytics Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  @Get('public/store-wallet/:storeId')
  async getStoreWallet(@Query('storeId') storeId: string) {
    try {
      const db = getPool();
      
      const walletResult = await db.query(`
        SELECT * FROM "StoreWallet" WHERE "storeId" = $1
      `, [storeId]);
      
      const wallet = walletResult.rows[0];

      if (!wallet) {
        // Create wallet if doesn't exist
        const newWallet = await db.query(`
          INSERT INTO "StoreWallet" ("id", "storeId", "totalEarnings", "withdrawableBalance")
          VALUES (gen_random_uuid(), $1, 0, 0)
          RETURNING *
        `, [storeId]);
        return { success: true, data: newWallet.rows[0] };
      }

      return {
        success: true,
        data: {
          totalEarnings: parseFloat(wallet.totalEarnings || 0),
          withdrawableBalance: parseFloat(wallet.withdrawableBalance || 0),
          pendingBalance: parseFloat(wallet.pendingBalance || 0),
          totalWithdrawn: parseFloat(wallet.totalWithdrawn || 0),
        },
      };
    } catch (error: any) {
      console.error('[Store Wallet Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  // ==================== ORDER FINANCIAL BREAKDOWN ====================

  @Get('public/order-breakdown/:orderId')
  async getOrderBreakdown(@Query('orderId') orderId: string) {
    try {
      const db = getPool();
      
      const orderResult = await db.query(`
        SELECT 
          o.id, o."orderNumber", o.status, o."totalAmount",
          o."distanceKm", o."productAmount", o."deliveryFee", 
          o."riderEarning", o."deliveryMargin", o."commissionAmount",
          o."platformFee", o."packingCharge", o."gstAmount",
          o."storeEarning", o."platformEarning",
          o."deliveryAddress", o."createdAt",
          s.name as "storeName", s.address as "storeAddress"
        FROM "Order" o
        JOIN "Store" s ON o."storeId" = s.id
        WHERE o.id = $1
      `, [orderId]);

      const order = orderResult.rows[0];

      if (!order) {
        return { success: false, error: 'Order not found', data: null };
      }

      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          store: {
            name: order.storeName,
            address: order.storeAddress,
          },
          distance: {
            km: parseFloat(order.distanceKm || 0),
          },
          breakdown: {
            productAmount: parseFloat(order.productAmount || 0),
            deliveryFee: parseFloat(order.deliveryFee || 0),
            platformFee: parseFloat(order.platformFee || 0),
            packingCharge: parseFloat(order.packingCharge || 0),
            gstAmount: parseFloat(order.gstAmount || 0),
            totalAmount: parseFloat(order.totalAmount || 0),
          },
          payouts: {
            storeEarning: parseFloat(order.storeEarning || 0),
            riderEarning: parseFloat(order.riderEarning || 0),
            platformEarning: parseFloat(order.platformEarning || 0),
          },
          deliveryAddress: order.deliveryAddress,
          date: order.createdAt,
        },
      };
    } catch (error: any) {
      console.error('[Order Breakdown Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  // ==================== PAYMENT ENDPOINTS ====================

  @Post('public/create-payment-order')
  async createPaymentOrder(
    @Body() body: {
      productAmount: number;
      storeId: string;
      storeLat: number;
      storeLng: number;
      deliveryLat: number;
      deliveryLng: number;
    }
  ) {
    try {
      const { productAmount, storeId, storeLat, storeLng, deliveryLat, deliveryLng } = body;

      // Calculate full financial breakdown
      const financials = calculateOrderFinancials(
        productAmount,
        storeLat,
        storeLng,
        deliveryLat,
        deliveryLng
      );

      // Create Razorpay order
      const receipt = `order_${Date.now()}_${storeId.slice(0, 8)}`;
      const razorpayOrder = await createRazorpayOrder(
        financials.totalAmount,
        {
          productAmount: financials.productAmount,
          deliveryFee: financials.deliveryFee,
          platformFee: financials.platformFee,
          packingCharge: financials.packingCharge,
          gstAmount: financials.gstAmount,
          totalAmount: financials.totalAmount,
        },
        receipt
      );

      return {
        success: true,
        data: {
          razorpayOrderId: razorpayOrder.razorpayOrderId,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          breakdown: razorpayOrder.breakdown,
          keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_SVS9yEFnBQEGdS',
        },
      };
    } catch (error: any) {
      console.error('[Create Payment Order Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  @Post('public/verify-payment')
  async verifyPayment(
    @Body() body: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
      orderId: string;
    }
  ) {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = body;

      // Verify signature
      const isValid = verifyPaymentSignature({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
      });

      if (!isValid) {
        return { success: false, error: 'Invalid payment signature', data: null };
      }

      const db = getPool();

      // Update order payment status - DO NOT update wallet yet
      await db.query(`
        UPDATE "Order" 
        SET "paymentStatus" = 'PAID',
            "razorpayOrderId" = $1,
            "razorpayPaymentId" = $2
        WHERE id = $3
      `, [razorpayOrderId, razorpayPaymentId, orderId]);

      return {
        success: true,
        data: {
          orderId,
          paymentStatus: 'PAID',
          message: 'Payment verified successfully. Wallet will be credited after delivery.',
        },
      };
    } catch (error: any) {
      console.error('[Verify Payment Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  // ==================== ORDER DETAILS WITH FULL BREAKDOWN ====================

  @Get('public/order/:id')
  async getOrderById(@Param('id') orderId: string) {
    try {
      const db = getPool();
      
      const orderResult = await db.query(`
        SELECT 
          o.id, o."orderNumber", o.status, o."paymentStatus", o."paymentMethod",
          o."totalAmount", o."createdAt", o."deliveredAt",
          o."distanceKm", o."productAmount", o."deliveryFee", 
          o."riderEarning", o."deliveryMargin", o."commissionAmount",
          o."platformFee", o."packingCharge", o."gstAmount",
          o."storeEarning", o."platformEarning",
          o."deliveryAddress", o."deliveryLat", o."deliveryLng",
          s.id as "storeId", s.name as "storeName", s.address as "storeAddress",
          s.latitude as "storeLat", s.longitude as "storeLng",
          u.name as "customerName", u.phone as "customerPhone"
        FROM "Order" o
        JOIN "Store" s ON o."storeId" = s.id
        LEFT JOIN "User" u ON o."userId" = u.id
        WHERE o.id = $1
      `, [orderId]);

      const order = orderResult.rows[0];

      if (!order) {
        return { success: false, error: 'Order not found', data: null };
      }

      // Get order items
      const itemsResult = await db.query(`
        SELECT id, "productId", "productName", size, quantity, "unitPrice"
        FROM "OrderItem"
        WHERE "orderId" = $1
      `, [orderId]);

      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          createdAt: order.createdAt,
          deliveredAt: order.deliveredAt,
          customer: {
            name: order.customerName,
            phone: order.customerPhone,
          },
          store: {
            id: order.storeId,
            name: order.storeName,
            address: order.storeAddress,
            latitude: order.storeLat,
            longitude: order.storeLng,
          },
          delivery: {
            address: order.deliveryAddress,
            latitude: order.deliveryLat,
            longitude: order.deliveryLng,
          },
          distance: {
            km: parseFloat(order.distanceKm || 0),
          },
          breakdown: {
            productAmount: parseFloat(order.productAmount || 0),
            deliveryFee: parseFloat(order.deliveryFee || 0),
            platformFee: parseFloat(order.platformFee || 0),
            packingCharge: parseFloat(order.packingCharge || 0),
            gstAmount: parseFloat(order.gstAmount || 0),
            commissionAmount: parseFloat(order.commissionAmount || 0),
            totalAmount: parseFloat(order.totalAmount || 0),
          },
          payouts: {
            storeEarning: parseFloat(order.storeEarning || 0),
            riderEarning: parseFloat(order.riderEarning || 0),
            platformEarning: parseFloat(order.platformEarning || 0),
          },
          items: itemsResult.rows.map((item: any) => ({
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            size: item.size,
            quantity: item.quantity,
            unitPrice: parseFloat(item.unitPrice || 0),
          })),
        },
      };
    } catch (error: any) {
      console.error('[Get Order Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }

  // ==================== STORE ORDERS WITH EARNINGS ====================

  @Get('public/store/orders/:storeId')
  async getStoreOrders(@Param('storeId') storeId: string) {
    try {
      const db = getPool();
      
      const ordersResult = await db.query(`
        SELECT 
          id, "orderNumber", status, "paymentStatus", "paymentMethod",
          "totalAmount", "createdAt", "deliveredAt",
          "productAmount", "commissionAmount", "storeEarning",
          "deliveryAddress"
        FROM "Order"
        WHERE "storeId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 50
      `, [storeId]);

      return {
        success: true,
        data: ordersResult.rows.map((order: any) => ({
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          productAmount: parseFloat(order.productAmount || 0),
          commissionAmount: parseFloat(order.commissionAmount || 0),
          storeEarning: parseFloat(order.storeEarning || 0),
          totalAmount: parseFloat(order.totalAmount || 0),
          deliveryAddress: order.deliveryAddress,
          createdAt: order.createdAt,
          deliveredAt: order.deliveredAt,
        })),
      };
    } catch (error: any) {
      console.error('[Store Orders Error]', error);
      return { success: false, error: error.message, data: [] };
    }
  }

  // ==================== STORE ANALYTICS ====================

  @Get('public/store/analytics/:storeId')
  async getStoreAnalyticsDashboard(@Param('storeId') storeId: string) {
    try {
      const db = getPool();
      
      // Get wallet
      const walletResult = await db.query(`
        SELECT * FROM "StoreWallet" WHERE "storeId" = $1
      `, [storeId]);
      
      const wallet = walletResult.rows[0];

      // Get today's earnings
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayResult = await db.query(`
        SELECT 
          COUNT(*) as orders,
          COALESCE(SUM("storeEarning"), 0) as earnings
        FROM "Order"
        WHERE "storeId" = $1 
          AND status = 'DELIVERED'
          AND "deliveredAt" >= $2
      `, [storeId, today]);

      const todayData = todayResult.rows[0];

      // Get total stats
      const statsResult = await db.query(`
        SELECT 
          COUNT(*) as "totalOrders",
          COALESCE(SUM("productAmount"), 0) as "totalRevenue",
          COALESCE(SUM("commissionAmount"), 0) as "totalCommission",
          COALESCE(SUM("storeEarning"), 0) as "totalEarnings"
        FROM "Order"
        WHERE "storeId" = $1 AND status = 'DELIVERED'
      `, [storeId]);

      const stats = statsResult.rows[0];

      return {
        success: true,
        data: {
          wallet: {
            totalEarnings: parseFloat(wallet?.totalEarnings || 0),
            withdrawableBalance: parseFloat(wallet?.withdrawableBalance || 0),
            pendingBalance: parseFloat(wallet?.pendingBalance || 0),
          },
          today: {
            orders: parseInt(todayData.orders || 0),
            earnings: parseFloat(todayData.earnings || 0),
          },
          total: {
            orders: parseInt(stats.totalOrders || 0),
            revenue: parseFloat(stats.totalRevenue || 0),
            commission: parseFloat(stats.totalCommission || 0),
            earnings: parseFloat(stats.totalEarnings || 0),
          },
        },
      };
    } catch (error: any) {
      console.error('[Store Analytics Error]', error);
      return { success: false, error: error.message, data: null };
    }
  }
}
