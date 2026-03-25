/**
 * Wallet Service for Outfyt
 * Handles all wallet operations for stores and riders
 */

import { PrismaClient, WalletType, WalletTransactionType, TransactionStatus } from '@prisma/client';

const prisma = new PrismaClient();

export interface WalletBalance {
  totalEarnings: number;
  withdrawableBalance: number;
  pendingBalance: number;
  totalWithdrawn: number;
}

export interface RiderWalletBalance extends WalletBalance {
  todayEarnings: number;
  weeklyEarnings: number;
  totalDeliveries: number;
}

/**
 * Get or create store wallet
 */
export async function getOrCreateStoreWallet(storeId: string) {
  let wallet = await prisma.storeWallet.findUnique({
    where: { storeId },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
  });

  if (!wallet) {
    wallet = await prisma.storeWallet.create({
      data: { storeId },
      include: { transactions: true },
    });
  }

  return wallet;
}

/**
 * Get or create rider wallet
 */
export async function getOrCreateRiderWallet(riderId: string) {
  let wallet = await prisma.riderWallet.findUnique({
    where: { riderId },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
  });

  if (!wallet) {
    wallet = await prisma.riderWallet.create({
      data: { riderId },
      include: { transactions: true },
    });
  }

  return wallet;
}

/**
 * Credit store wallet for order earning
 */
export async function creditStoreWallet(
  storeId: string,
  amount: number,
  orderId: string,
  description?: string
) {
  const wallet = await getOrCreateStoreWallet(storeId);

  // Create transaction
  await prisma.walletTransaction.create({
    data: {
      walletType: WalletType.STORE,
      storeWalletId: wallet.id,
      amount,
      type: WalletTransactionType.ORDER_EARNING,
      status: TransactionStatus.SUCCESS,
      orderId,
      description: description || `Order earning for order ${orderId}`,
    },
  });

  // Update wallet balance
  return prisma.storeWallet.update({
    where: { id: wallet.id },
    data: {
      totalEarnings: { increment: amount },
      withdrawableBalance: { increment: amount },
    },
  });
}

/**
 * Credit rider wallet for delivery earning
 */
export async function creditRiderWallet(
  riderId: string,
  amount: number,
  orderId: string,
  description?: string
) {
  const wallet = await getOrCreateRiderWallet(riderId);

  // Create transaction
  await prisma.walletTransaction.create({
    data: {
      walletType: WalletType.RIDER,
      riderWalletId: wallet.id,
      amount,
      type: WalletTransactionType.DELIVERY_EARNING,
      status: TransactionStatus.SUCCESS,
      orderId,
      description: description || `Delivery earning for order ${orderId}`,
    },
  });

  // Update wallet balance
  return prisma.riderWallet.update({
    where: { id: wallet.id },
    data: {
      totalEarnings: { increment: amount },
      withdrawableBalance: { increment: amount },
      todayEarnings: { increment: amount },
      weeklyEarnings: { increment: amount },
      totalDeliveries: { increment: 1 },
    },
  });
}

/**
 * Process wallet credits after order delivery
 */
export async function processOrderPayouts(
  orderId: string,
  storeId: string,
  riderId: string,
  storeEarning: number,
  riderEarning: number
) {
  // Credit store wallet
  if (storeEarning > 0) {
    await creditStoreWallet(storeId, storeEarning, orderId, 'Order completed');
  }

  // Credit rider wallet
  if (riderEarning > 0) {
    await creditRiderWallet(riderId, riderEarning, orderId, 'Delivery completed');
  }

  return { success: true };
}

/**
 * Get store wallet balance
 */
export async function getStoreWalletBalance(storeId: string): Promise<WalletBalance> {
  const wallet = await getOrCreateStoreWallet(storeId);
  return {
    totalEarnings: wallet.totalEarnings,
    withdrawableBalance: wallet.withdrawableBalance,
    pendingBalance: wallet.pendingBalance,
    totalWithdrawn: wallet.totalWithdrawn,
  };
}

/**
 * Get rider wallet balance with analytics
 */
export async function getRiderWalletBalance(riderId: string): Promise<RiderWalletBalance> {
  const wallet = await getOrCreateRiderWallet(riderId);
  return {
    totalEarnings: wallet.totalEarnings,
    withdrawableBalance: wallet.withdrawableBalance,
    pendingBalance: wallet.pendingBalance,
    totalWithdrawn: wallet.totalWithdrawn,
    todayEarnings: wallet.todayEarnings,
    weeklyEarnings: wallet.weeklyEarnings,
    totalDeliveries: wallet.totalDeliveries,
  };
}

/**
 * Reset daily earnings (run at midnight)
 */
export async function resetRiderDailyEarnings() {
  return prisma.riderWallet.updateMany({
    data: { todayEarnings: 0 },
  });
}

/**
 * Reset weekly earnings (run on Monday midnight)
 */
export async function resetRiderWeeklyEarnings() {
  return prisma.riderWallet.updateMany({
    data: { weeklyEarnings: 0 },
  });
}

/**
 * Process withdrawal request
 */
export async function processWithdrawal(
  walletType: WalletType,
  walletId: string,
  amount: number
) {
  if (walletType === WalletType.STORE) {
    const wallet = await prisma.storeWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.withdrawableBalance < amount) {
      throw new Error('Insufficient balance');
    }

    await prisma.walletTransaction.create({
      data: {
        walletType: WalletType.STORE,
        storeWalletId: walletId,
        amount: -amount,
        type: WalletTransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
        description: 'Withdrawal request',
      },
    });

    return prisma.storeWallet.update({
      where: { id: walletId },
      data: {
        withdrawableBalance: { decrement: amount },
        totalWithdrawn: { increment: amount },
      },
    });
  } else {
    const wallet = await prisma.riderWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.withdrawableBalance < amount) {
      throw new Error('Insufficient balance');
    }

    await prisma.walletTransaction.create({
      data: {
        walletType: WalletType.RIDER,
        riderWalletId: walletId,
        amount: -amount,
        type: WalletTransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
        description: 'Withdrawal request',
      },
    });

    return prisma.riderWallet.update({
      where: { id: walletId },
      data: {
        withdrawableBalance: { decrement: amount },
        totalWithdrawn: { increment: amount },
      },
    });
  }
}

/**
 * Get rider earnings analytics
 */
export async function getRiderEarningsAnalytics(riderId: string) {
  const wallet = await getOrCreateRiderWallet(riderId);
  
  // Get earnings per order
  const recentTransactions = await prisma.walletTransaction.findMany({
    where: {
      riderWalletId: wallet.id,
      type: WalletTransactionType.DELIVERY_EARNING,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  // Get daily earnings for last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dailyEarnings = await prisma.walletTransaction.groupBy({
    by: ['createdAt'],
    where: {
      riderWalletId: wallet.id,
      type: WalletTransactionType.DELIVERY_EARNING,
      createdAt: { gte: sevenDaysAgo },
    },
    _sum: { amount: true },
  });

  return {
    totalEarnings: wallet.totalEarnings,
    todayEarnings: wallet.todayEarnings,
    weeklyEarnings: wallet.weeklyEarnings,
    totalDeliveries: wallet.totalDeliveries,
    withdrawableBalance: wallet.withdrawableBalance,
    recentEarnings: recentTransactions.map(t => ({
      amount: t.amount,
      orderId: t.orderId,
      date: t.createdAt,
    })),
  };
}

/**
 * Get store earnings analytics
 */
export async function getStoreEarningsAnalytics(storeId: string) {
  const wallet = await getOrCreateStoreWallet(storeId);
  
  // Get total orders and commission
  const orders = await prisma.order.findMany({
    where: { storeId },
    select: {
      productAmount: true,
      commissionAmount: true,
      storeEarning: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const totalRevenue = orders.reduce((sum, o) => sum + o.productAmount, 0);
  const totalCommission = orders.reduce((sum, o) => sum + o.commissionAmount, 0);

  return {
    totalEarnings: wallet.totalEarnings,
    withdrawableBalance: wallet.withdrawableBalance,
    totalRevenue,
    totalCommission,
    totalOrders: orders.length,
    recentOrders: orders.slice(0, 10).map(o => ({
      productAmount: o.productAmount,
      commissionAmount: o.commissionAmount,
      storeEarning: o.storeEarning,
      date: o.createdAt,
    })),
  };
}

export default {
  getOrCreateStoreWallet,
  getOrCreateRiderWallet,
  creditStoreWallet,
  creditRiderWallet,
  processOrderPayouts,
  getStoreWalletBalance,
  getRiderWalletBalance,
  resetRiderDailyEarnings,
  resetRiderWeeklyEarnings,
  processWithdrawal,
  getRiderEarningsAnalytics,
  getStoreEarningsAnalytics,
};
