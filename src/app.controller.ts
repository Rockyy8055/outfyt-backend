import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('public/admin-data')
  async getPublicAdminData() {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    });
    
    const [
      ordersCount,
      revenueResult,
      storesCount,
      usersCount,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM orders'),
      pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE payment_status = 'SUCCESS'"),
      pool.query('SELECT COUNT(*) as count FROM stores'),
      pool.query('SELECT COUNT(*) as count FROM users'),
    ]);
    
    return {
      totalOrders: parseInt(ordersCount.rows[0]?.count || 0),
      totalRevenue: parseFloat(revenueResult.rows[0]?.total || 0),
      totalStores: parseInt(storesCount.rows[0]?.count || 0),
      totalUsers: parseInt(usersCount.rows[0]?.count || 0),
      timestamp: new Date().toISOString(),
    };
  }
}
