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
    const { orderId, riderId, status, otpCode, amountReceived } = body;
    
    if (!orderId || !riderId || !status) {
      return new Response(JSON.stringify({ error: 'Missing orderId, riderId, or status' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Verify rider is assigned to this order
    if (order.riderId !== riderId) {
      return new Response(JSON.stringify({ error: 'You are not assigned to this order' }), {
        status: 403,
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
        error: `Cannot transition from ${order.status} to ${status}` 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // For DELIVERED status, verify OTP code
    if (status === 'DELIVERED') {
      if (!otpCode) {
        return new Response(JSON.stringify({ error: 'OTP code required for delivery confirmation' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (otpCode !== order.otpCode) {
        return new Response(JSON.stringify({ error: 'Invalid OTP code' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // Update order
    const updateData: Record<string, any> = { status };
    
    if (status === 'OUT_FOR_DELIVERY') {
      // No additional fields needed
    }
    
    if (status === 'DELIVERED') {
      updateData.deliveredAt = new Date().toISOString();
      if (order.paymentMethod === 'COD') {
        updateData.amountReceived = amountReceived || order.totalAmount;
        updateData.paymentStatus = 'SUCCESS';
      }
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

    // Send notifications
    const { data: customerTokens } = await supabase
      .from('DeviceToken')
      .select('token')
      .eq('userId', order.userId);

    if (customerTokens && customerTokens.length > 0) {
      const notificationTitles: Record<string, string> = {
        'OUT_FOR_DELIVERY': 'Out for Delivery! 🚗',
        'DELIVERED': 'Order Delivered! 🎉',
      };

      const notificationBodies: Record<string, string> = {
        'OUT_FOR_DELIVERY': `Your order #${order.orderNumber} is on the way!`,
        'DELIVERED': `Your order #${order.orderNumber} has been delivered. Thank you!`,
      };

      const messages = customerTokens.map(dt => ({
        to: dt.token,
        sound: 'default',
        title: notificationTitles[status],
        body: notificationBodies[status],
        data: {
          type: `ORDER_${status}`,
          orderId: order.id,
          status,
        },
      }));

      try {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages),
        });
      } catch (e) {
        console.error('Push error:', e);
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status,
        deliveredAt: status === 'DELIVERED' ? new Date().toISOString() : null,
        amountReceived: status === 'DELIVERED' ? (amountReceived || order.totalAmount) : null,
      },
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
