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
    const { orderId, storeOwnerId } = body;
    
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get order with store location
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select(`
        id, 
        storeId, 
        status, 
        orderNumber,
        totalAmount,
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        otpCode,
        store:storeId (id, name, address, latitude, longitude)
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found', details: orderError?.message }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (order.status !== 'ACCEPTED' && order.status !== 'PACKING') {
      return new Response(JSON.stringify({ error: 'Order must be ACCEPTED or PACKING', currentStatus: order.status }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Generate handover code (6 digits)
    const handoverCode = String(Math.floor(100000 + Math.random() * 900000));

    // Update order status to READY with handover code
    const { error: updateError } = await supabase
      .from('Order')
      .update({
        status: 'READY',
        packedAt: new Date().toISOString(),
        handoverCode: handoverCode,
      })
      .eq('id', orderId);

    if (updateError) {
      return new Response(JSON.stringify({ error: 'Failed to update order', details: updateError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Note: OrderAlerts are NOT created here anymore
    // Riders will manually search for nearby orders via get-nearby-orders
    // Alerts will only be created when a specific delivery request needs to be sent

    // Fetch updated order
    const { data: updatedOrder } = await supabase
      .from('Order')
      .select('id, orderNumber, status, otpCode, handoverCode, packedAt')
      .eq('id', orderId)
      .single();

    return new Response(JSON.stringify({ 
      success: true,
      order: updatedOrder,
      handoverCode: handoverCode,
      message: 'Order is ready for pickup'
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
