import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const body = await req.json();
    const { storeId, storeOwnerId } = body;
    
    if (!storeId && !storeOwnerId) {
      return new Response(JSON.stringify({ error: 'Missing storeId or storeOwnerId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get store ID if only storeOwnerId provided
    let targetStoreId = storeId;
    if (!targetStoreId && storeOwnerId) {
      const { data: store, error: storeError } = await supabase
        .from('Store')
        .select('id')
        .eq('ownerId', storeOwnerId)
        .single();
      
      if (storeError || !store) {
        return new Response(JSON.stringify({ error: 'Store not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      targetStoreId = store.id;
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString();

    // Get today's orders count
    const { count: todayOrdersCount } = await supabase
      .from('Order')
      .select('*', { count: 'exact', head: true })
      .eq('storeId', targetStoreId)
      .gte('createdAt', todayISO)
      .lt('createdAt', tomorrowISO);

    // Get total orders count
    const { count: totalOrdersCount } = await supabase
      .from('Order')
      .select('*', { count: 'exact', head: true })
      .eq('storeId', targetStoreId);

    // Get today's revenue (sum of totalAmount for delivered orders today)
    const { data: todayRevenueData } = await supabase
      .from('Order')
      .select('totalAmount')
      .eq('storeId', targetStoreId)
      .eq('status', 'DELIVERED')
      .gte('createdAt', todayISO)
      .lt('createdAt', tomorrowISO);

    const todayRevenue = (todayRevenueData || []).reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Get total revenue (sum of totalAmount for all delivered orders)
    const { data: totalRevenueData } = await supabase
      .from('Order')
      .select('totalAmount')
      .eq('storeId', targetStoreId)
      .eq('status', 'DELIVERED');

    const totalRevenue = (totalRevenueData || []).reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Get amount received today (COD orders delivered today)
    const { data: todayReceivedData } = await supabase
      .from('Order')
      .select('amountReceived, totalAmount')
      .eq('storeId', targetStoreId)
      .eq('status', 'DELIVERED')
      .eq('paymentMethod', 'COD')
      .gte('deliveredAt', todayISO)
      .lt('deliveredAt', tomorrowISO);

    const todayAmountReceived = (todayReceivedData || []).reduce((sum, order) => {
      return sum + (order.amountReceived || order.totalAmount || 0);
    }, 0);

    // Get pending amount (COD orders delivered but not yet received + pending orders)
    const { data: pendingCodData } = await supabase
      .from('Order')
      .select('totalAmount')
      .eq('storeId', targetStoreId)
      .eq('paymentMethod', 'COD')
      .eq('paymentStatus', 'COD_PENDING')
      .in('status', ['DELIVERED', 'OUT_FOR_DELIVERY', 'PICKED_UP', 'READY']);

    const pendingAmount = (pendingCodData || []).reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Get inventory count (total products in store)
    const { count: inventoryCount } = await supabase
      .from('Product')
      .select('*', { count: 'exact', head: true })
      .eq('storeId', targetStoreId);

    // Get pending orders count (orders waiting for action)
    const { count: pendingOrdersCount } = await supabase
      .from('Order')
      .select('*', { count: 'exact', head: true })
      .eq('storeId', targetStoreId)
      .in('status', ['PENDING', 'ACCEPTED', 'PACKING']);

    // Get orders by status for today
    const { data: todayOrdersByStatus } = await supabase
      .from('Order')
      .select('status')
      .eq('storeId', targetStoreId)
      .gte('createdAt', todayISO)
      .lt('createdAt', tomorrowISO);

    const statusCounts = (todayOrdersByStatus || []).reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const dashboard = {
      todayOrders: todayOrdersCount || 0,
      totalOrders: totalOrdersCount || 0,
      todayRevenue: todayRevenue,
      totalRevenue: totalRevenue,
      todayAmountReceived: todayAmountReceived,
      pendingAmount: pendingAmount,
      inventoryCount: inventoryCount || 0,
      pendingOrders: pendingOrdersCount || 0,
      todayOrdersByStatus: statusCounts,
    };

    return new Response(JSON.stringify({ 
      success: true,
      dashboard 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
