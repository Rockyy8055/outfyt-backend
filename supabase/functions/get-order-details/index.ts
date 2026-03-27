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
    const { orderId, userId } = body;
    
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select(`
        id,
        orderNumber,
        status,
        totalAmount,
        paymentMethod,
        paymentStatus,
        otpCode,
        handoverCode,
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        createdAt,
        userId,
        storeId,
        riderId,
        customerName,
        customerPhone,
        storeName
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Verify user owns this order (if userId provided)
    if (userId && order.userId !== userId) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get store info with location
    const { data: store } = await supabase
      .from('Store')
      .select('id, name, address, latitude, longitude')
      .eq('id', order.storeId)
      .single();

    // Get order items with all details
    const { data: items } = await supabase
      .from('OrderItem')
      .select('id, productId, productName, size, quantity, unitPrice, offerPercentage, image')
      .eq('orderId', orderId);

    // Calculate item totals
    const orderItems = (items || []).map(item => ({
      ...item,
      totalPrice: item.quantity * item.unitPrice,
      discountedPrice: item.offerPercentage 
        ? item.quantity * item.unitPrice * (1 - item.offerPercentage / 100)
        : null
    }));

    // Get rider info if assigned
    let rider = null;
    if (order.riderId) {
      const { data: riderData } = await supabase
        .from('User')
        .select('id, name, phone')
        .eq('id', order.riderId)
        .single();
      rider = riderData;
    }

    const response = {
      ...order,
      store: store || null,
      items: orderItems,
      rider: rider
    };

    return new Response(JSON.stringify({ success: true, order: response }), {
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
