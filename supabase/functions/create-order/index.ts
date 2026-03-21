import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

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
    // Read body once at the start
    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    
    // Create admin client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get user from Supabase Edge Runtime context
    const authHeader = req.headers.get('Authorization');
    console.log('🔐 Auth header present:', !!authHeader);
    
    // Extract userId - prefer body.userId, then try JWT
    let userId = body.userId;
    
    if (!userId && authHeader) {
      const token = authHeader.replace('Bearer ', '');
      console.log('� Token length:', token.length);
      
      // Try to decode JWT manually
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          userId = payload.sub;
          console.log('📦 JWT sub:', userId);
        }
      } catch (decodeError) {
        console.log('⚠️ JWT decode failed:', decodeError);
      }
    }
    
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unable to identify user. Please provide userId in body or valid JWT token.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    
    console.log('✅ Using userId:', userId);
    
    // Create order with the body and userId
    return await createOrderWithBody(body, supabase, userId);
    
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});

async function createOrderWithBody(body: any, supabase: any, userId: string): Promise<Response> {
  try {
    const { storeId, items, paymentMethod, deliveryLat, deliveryLng, deliveryAddress } = body;

    // Validate required fields
    if (!storeId || !items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing required fields: storeId, items' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (!deliveryLat || !deliveryLng) {
      return new Response(JSON.stringify({ error: 'Missing delivery location' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Verify store exists and get location
    const { data: store, error: storeError } = await supabase
      .from('Store')
      .select('id, name, address, latitude, longitude')
      .eq('id', storeId)
      .single();

    if (storeError || !store) {
      return new Response(JSON.stringify({ error: 'Store not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Use product details from request (customer app sends productName and unitPrice)
    const orderItems = items.map((item: any) => ({
      productId: item.productId,
      productName: item.productName || 'Product',
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice || 0,
      offerPercentage: item.offerPercentage || null,
    }));

    // Calculate total amount
    const totalAmount = orderItems.reduce((sum: number, item: any) => sum + (item.unitPrice * item.quantity), 0);

    // Generate order number and OTP
    const orderNumber = `ORD${Date.now().toString(36).toUpperCase()}`;
    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

    // Create order with items
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .insert({
        orderNumber,
        userId: userId,
        storeId,
        status: 'PENDING',
        paymentMethod: paymentMethod || 'COD',
        paymentStatus: 'PENDING',
        totalAmount,
        otpCode,
        deliveryLat,
        deliveryLng,
        deliveryAddress: deliveryAddress || null,
      })
      .select('id, orderNumber, status, totalAmount, otpCode')
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Failed to create order', details: orderError?.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Create order items with generated UUIDs
    const orderItemsToInsert = orderItems.map(item => ({
      id: crypto.randomUUID(),
      orderId: order.id,
      storeId: storeId,
      productId: item.productId,
      productName: item.productName,
      name: item.productName,
      size: item.size,
      quantity: item.quantity,
      price: item.unitPrice,
      unitPrice: item.unitPrice,
      totalPrice: item.unitPrice * item.quantity,
      offerPercentage: item.offerPercentage,
    }));

    console.log('📦 Inserting OrderItems:', JSON.stringify(orderItemsToInsert, null, 2));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('OrderItem')
      .insert(orderItemsToInsert)
      .select('id, productName, size, quantity, unitPrice');

    if (itemsError) {
      console.error('❌ Failed to create order items:', itemsError);
      console.error('❌ Items error details:', JSON.stringify(itemsError, null, 2));
      // Rollback the order if items fail
      await supabase.from('Order').delete().eq('id', order.id);
      return new Response(JSON.stringify({ 
        error: 'Failed to create order items', 
        details: itemsError.message,
        hint: 'Check if OrderItem table exists and columns match: orderId, productId, productName, size, quantity, unitPrice, offerPercentage'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    console.log(`✅ Order created: ${order.id} with ${insertedItems?.length || 0} items for user ${userId}`);
    console.log('✅ Inserted items:', JSON.stringify(insertedItems, null, 2));

    return new Response(JSON.stringify({
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.totalAmount,
      otpCode: order.otpCode,
      handoverCode: order.otpCode,
      itemCount: orderItems.length,
      store: {
        id: store.id,
        name: store.name,
        address: store.address,
        latitude: store.latitude,
        longitude: store.longitude,
      },
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
}
