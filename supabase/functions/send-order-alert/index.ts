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
    const { orderId, riderId } = body;
    
    if (!orderId || !riderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId or riderId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select(`
        id,
        orderNumber,
        status,
        totalAmount,
        otpCode,
        handoverCode,
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        storeId,
        store:storeId (id, name, address, latitude, longitude)
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if order is READY for pickup
    if (order.status !== 'READY') {
      return new Response(JSON.stringify({ 
        error: 'Order not ready for pickup', 
        currentStatus: order.status 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if order already has a rider
    const { data: existingOrder } = await supabase
      .from('Order')
      .select('riderId')
      .eq('id', orderId)
      .single();

    if (existingOrder?.riderId && existingOrder.riderId !== riderId) {
      return new Response(JSON.stringify({ error: 'Order already assigned to another rider' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get rider details
    const { data: rider, error: riderError } = await supabase
      .from('User')
      .select('id, name, phone')
      .eq('id', riderId)
      .single();

    if (riderError || !rider) {
      return new Response(JSON.stringify({ error: 'Rider not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Calculate estimated earnings (example: flat fee + distance based)
    const estimatedEarnings = 30; // Base delivery fee in rupees

    // Create order alert entry (for tracking)
    const expiresAt = new Date(Date.now() + 60 * 1000); // 1 minute from now

    const { data: orderAlert, error: alertError } = await supabase
      .from('OrderAlert')
      .upsert({
        orderId,
        riderId,
        status: 'PENDING',
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
      }, { onConflict: 'orderId,riderId' })
      .select()
      .single();

    if (alertError) {
      console.error('Failed to create order alert:', alertError);
    }

    // Send push notification to rider
    const { data: deviceTokens } = await supabase
      .from('DeviceToken')
      .select('token')
      .eq('userId', riderId);

    if (deviceTokens && deviceTokens.length > 0) {
      // Send push notification via Expo
      const messages = deviceTokens.map(dt => ({
        to: dt.token,
        sound: 'default',
        title: 'New Delivery Order! 📦',
        body: `Order #${order.orderNumber} - Pickup from ${order.store?.name || 'Store'}`,
        data: {
          type: 'NEW_ORDER',
          orderId: order.id,
          orderNumber: order.orderNumber,
        },
        priority: 'high',
      }));

      try {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messages),
        });
      } catch (pushError) {
        console.error('Push notification error:', pushError);
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        otpCode: order.otpCode,
        handoverCode: order.handoverCode,
        deliveryAddress: order.deliveryAddress,
        deliveryLat: order.deliveryLat,
        deliveryLng: order.deliveryLng,
        estimatedEarnings,
        store: order.store,
      },
      alert: {
        id: orderAlert?.id,
        expiresAt: expiresAt.toISOString(),
        timeLimit: 60, // seconds
      },
      message: 'Order alert sent to rider'
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
