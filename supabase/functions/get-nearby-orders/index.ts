import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Haversine formula to calculate distance
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
    const { riderId, latitude, longitude, radius = 25 } = body;
    
    if (!latitude || !longitude) {
      return new Response(JSON.stringify({ error: 'Missing latitude or longitude' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get all orders with READY status (ready for pickup, waiting for rider)
    const { data: orders, error: ordersError } = await supabase
      .from('Order')
      .select(`
        id,
        orderNumber,
        status,
        totalAmount,
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        createdAt,
        storeId,
        riderId,
        store:storeId (
          id,
          name,
          address,
          latitude,
          longitude,
          phone
        )
      `)
      .eq('status', 'READY')
      .is('riderId', null)  // Only orders without a rider assigned
      .order('createdAt', { ascending: true });

    if (ordersError) {
      return new Response(JSON.stringify({ error: 'Failed to fetch orders', details: ordersError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Filter orders within radius and calculate distance
    const nearbyOrders = (orders || [])
      .map((order: any) => {
        const store = order.store;
        if (!store?.latitude || !store?.longitude) return null;
        
        const distance = calculateDistance(
          latitude,
          longitude,
          store.latitude,
          store.longitude
        );
        
        if (distance > radius) return null;
        
        // Calculate estimated earnings (10% of order value or minimum ₹20)
        const earnings = Math.max(order.totalAmount * 0.1, 20);
        
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalAmount: order.totalAmount,
          estimatedEarnings: Math.round(earnings * 100) / 100,
          distance: Math.round(distance * 10) / 10,
          deliveryAddress: order.deliveryAddress,
          deliveryLat: order.deliveryLat,
          deliveryLng: order.deliveryLng,
          createdAt: order.createdAt,
          store: {
            id: store.id,
            name: store.name,
            address: store.address,
            latitude: store.latitude,
            longitude: store.longitude,
            phone: store.phone,
          },
        };
      })
      .filter((order): order is NonNullable<typeof order> => order !== null)
      .sort((a, b) => a.distance - b.distance);

    // Check if rider has any pending OrderAlerts
    let pendingAlerts: any[] = [];
    if (riderId) {
      const { data: alerts } = await supabase
        .from('OrderAlert')
        .select(`
          id,
          orderId,
          status,
          expiresAt,
          createdAt,
          Order (
            id,
            orderNumber,
            status,
            totalAmount,
            deliveryAddress,
            deliveryLat,
            deliveryLng,
            store:storeId (
              id,
              name,
              address,
              latitude,
              longitude,
              phone
            )
          )
        `)
        .eq('riderId', riderId)
        .eq('status', 'PENDING')
        .gt('expiresAt', new Date().toISOString());

      if (alerts) {
        pendingAlerts = alerts.map((alert: any) => {
          const order = alert.Order;
          const store = order?.store;
          const distance = store?.latitude && store?.longitude
            ? calculateDistance(latitude, longitude, store.latitude, store.longitude)
            : 0;
          const earnings = order ? Math.max(order.totalAmount * 0.1, 20) : 20;
          
          return {
            alertId: alert.id,
            id: order?.id,
            orderNumber: order?.orderNumber,
            status: order?.status,
            totalAmount: order?.totalAmount,
            estimatedEarnings: Math.round(earnings * 100) / 100,
            distance: Math.round(distance * 10) / 10,
            deliveryAddress: order?.deliveryAddress,
            deliveryLat: order?.deliveryLat,
            deliveryLng: order?.deliveryLng,
            store: store ? {
              id: store.id,
              name: store.name,
              address: store.address,
              latitude: store.latitude,
              longitude: store.longitude,
              phone: store.phone,
            } : null,
            expiresAt: alert.expiresAt,
          };
        });
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      nearbyOrders,
      pendingAlerts,
      totalOrders: nearbyOrders.length,
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
