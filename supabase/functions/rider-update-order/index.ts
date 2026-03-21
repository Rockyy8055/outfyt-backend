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
    const { orderId, status, otpCode, riderId } = body;
    
    if (!orderId || !status) {
      return new Response(JSON.stringify({ error: 'Missing orderId or status' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select('id, status, otpCode, userId, riderId')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      'PICKED_UP': ['OUT_FOR_DELIVERY'],
      'OUT_FOR_DELIVERY': ['DELIVERED'],
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return new Response(JSON.stringify({ 
        error: `Cannot transition from ${order.status} to ${status}`,
        currentStatus: order.status 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // For DELIVERED status, verify otpCode
    if (status === 'DELIVERED') {
      if (!otpCode) {
        return new Response(JSON.stringify({ error: 'otpCode is required to mark as delivered' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      
      if (order.otpCode !== otpCode) {
        return new Response(JSON.stringify({ error: 'Invalid otpCode' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // Update order status
    const updateData: Record<string, any> = { status };
    
    if (status === 'OUT_FOR_DELIVERY') {
      updateData.outForDeliveryAt = new Date().toISOString();
      // Assign rider if provided
      if (riderId) {
        updateData.riderId = riderId;
      }
    } else if (status === 'DELIVERED') {
      updateData.deliveredAt = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('Order')
      .update(updateData)
      .eq('id', orderId);

    if (updateError) {
      return new Response(JSON.stringify({ error: 'Failed to update order', details: updateError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Send notification to customer
    let notificationTitle = '';
    let notificationBody = '';
    
    if (status === 'OUT_FOR_DELIVERY') {
      notificationTitle = 'Order Out for Delivery';
      notificationBody = 'Your order is on the way!';
    } else if (status === 'DELIVERED') {
      notificationTitle = 'Order Delivered';
      notificationBody = 'Your order has been delivered. Thank you!';
    }

    if (notificationTitle) {
      await supabase.from('Notification').insert({
        userId: order.userId,
        title: notificationTitle,
        body: notificationBody,
        data: {
          type: `order.${status.toLowerCase()}`,
          orderId: orderId,
        },
        read: false,
      });
    }

    return new Response(JSON.stringify({ 
      success: true,
      status: status,
      message: `Order status updated to ${status}`
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
