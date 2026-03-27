import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Haversine formula to calculate distance in meters
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
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
    const { orderId, riderId, verificationCode, handoverCode, riderLat, riderLng } = body;
    
    // Accept both verificationCode and handoverCode for compatibility
    const code = verificationCode || handoverCode;
    
    if (!orderId || !riderId) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Missing orderId or riderId' 
      }), {
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
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        riderId,
        storeId,
        userId,
        store:storeId (id, name, address, latitude, longitude),
        user:userId (id, name, phone)
      `)
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

    // Check if order is READY or ACCEPTED (ready for pickup)
    if (order.status !== 'READY' && order.status !== 'ACCEPTED') {
      return new Response(JSON.stringify({ 
        error: 'Order not ready for pickup', 
        currentStatus: order.status 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Geolocation verification - rider must be within 30m of store (GPS accuracy buffer)
    // TEMPORARILY DISABLED FOR TESTING - uncomment when ready for production
    // const storeData = Array.isArray(order.store) ? order.store[0] : order.store;
    // if (riderLat && riderLng && storeData?.latitude && storeData?.longitude) {
    //   const distanceToStore = calculateDistance(riderLat, riderLng, storeData.latitude, storeData.longitude);
    //   if (distanceToStore > 30) {
    //     return new Response(JSON.stringify({ 
    //       error: 'Please reach the store location to confirm pickup',
    //       distanceToStore: Math.round(distanceToStore),
    //       requiredDistance: 30,
    //       storeLocation: { lat: storeData.latitude, lng: storeData.longitude },
    //       riderLocation: { lat: riderLat, lng: riderLng }
    //     }), {
    //       status: 400,
    //       headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    //     });
    //   }
    // }
    const storeData = Array.isArray(order.store) ? order.store[0] : order.store;

    // Verify verification code if provided
    if (code && order.otpCode && code !== order.otpCode) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Invalid verification code' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Update order status to OUT_FOR_DELIVERY (rider has picked up and is heading to customer)
    const { error: updateError } = await supabase
      .from('Order')
      .update({
        status: 'OUT_FOR_DELIVERY',
        pickedUpAt: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      return new Response(JSON.stringify({ error: 'Failed to update order', details: updateError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Send notification to customer
    const { data: customerTokens } = await supabase
      .from('DeviceToken')
      .select('token')
      .eq('userId', order.userId);

    if (customerTokens && customerTokens.length > 0) {
      const messages = customerTokens.map(dt => ({
        to: dt.token,
        sound: 'default',
        title: 'Order Picked Up! 📦',
        body: `Your order #${order.orderNumber} has been picked up and is on the way`,
        data: {
          type: 'ORDER_PICKED_UP',
          orderId: order.id,
          status: 'PICKED_UP',
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

    // Send notification to store
    const { data: storeOwner } = await supabase
      .from('Store')
      .select('ownerId')
      .eq('id', order.storeId)
      .single();

    if (storeOwner?.ownerId) {
      const { data: storeTokens } = await supabase
        .from('DeviceToken')
        .select('token')
        .eq('userId', storeOwner.ownerId);

      if (storeTokens && storeTokens.length > 0) {
        const messages = storeTokens.map(dt => ({
          to: dt.token,
          sound: 'default',
          title: 'Order Picked Up! ✅',
          body: `Order #${order.orderNumber} has been picked up by the delivery partner`,
          data: {
            type: 'ORDER_PICKED_UP',
            orderId: order.id,
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
    }

    const userData = Array.isArray(order.user) ? order.user[0] : order.user;

    return new Response(JSON.stringify({ 
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: 'PICKED_UP',
        verification_code: order.otpCode,
        // Customer details for delivery
        customer_id: userData?.id || '',
        customer_name: userData?.name || 'Customer',
        customer_phone: userData?.phone || '',
        customer_address: order.deliveryAddress || '',
        customer_lat: order.deliveryLat || 0,
        customer_lng: order.deliveryLng || 0,
        // Store details
        store_name: storeData?.name || '',
        store_address: storeData?.address || '',
      },
      message: 'Order picked up successfully'
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
