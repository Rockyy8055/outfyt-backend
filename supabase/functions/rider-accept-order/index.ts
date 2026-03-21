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
    const { alertId, orderId: providedOrderId, riderId } = body;
    
    if (!riderId) {
      return new Response(JSON.stringify({ error: 'Missing riderId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get orderId from alertId if provided, otherwise use provided orderId
    let orderId = providedOrderId;
    
    if (alertId && !orderId) {
      const { data: alertData, error: alertFetchError } = await supabase
        .from('OrderAlert')
        .select('orderId, status, expiresAt')
        .eq('id', alertId)
        .eq('riderId', riderId)
        .single();
      
      if (alertFetchError || !alertData) {
        return new Response(JSON.stringify({ error: 'Order alert not found' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      
      orderId = alertData.orderId;
      
      // Check if alert has expired
      if (new Date(alertData.expiresAt) < new Date()) {
        await supabase
          .from('OrderAlert')
          .update({ status: 'EXPIRED' })
          .eq('id', alertId);
        
        return new Response(JSON.stringify({ error: 'Order alert has expired' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      
      // Check if alert is still PENDING
      if (alertData.status !== 'PENDING') {
        return new Response(JSON.stringify({ error: 'Order alert already processed', status: alertData.status }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }
    
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing orderId or alertId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if order alert is still valid
    const { data: alert, error: alertError } = await supabase
      .from('OrderAlert')
      .select('*')
      .eq('orderId', orderId)
      .eq('riderId', riderId)
      .eq('status', 'PENDING')
      .single();

    if (alertError || !alert) {
      return new Response(JSON.stringify({ error: 'Order alert not found or already processed', details: alertError?.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if alert has expired
    if (new Date(alert.expiresAt) < new Date()) {
      await supabase
        .from('OrderAlert')
        .update({ status: 'EXPIRED' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ error: 'Order alert has expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get order details with customer info
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
        storeId,
        userId,
        store:storeId (id, name, address, latitude, longitude),
        user:userId (id, name, phone)
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found', details: orderError?.message }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Fetch order items separately
    const { data: orderItems } = await supabase
      .from('OrderItem')
      .select('id, productId, productName, size, quantity, unitPrice, offerPercentage')
      .eq('orderId', orderId);

    // Check if order is still READY or ACCEPTED (ready for rider assignment)
    if (order.status !== 'READY' && order.status !== 'ACCEPTED') {
      return new Response(JSON.stringify({ 
        error: 'Order no longer available', 
        currentStatus: order.status 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if already assigned to another rider
    const { data: existingAssignment } = await supabase
      .from('Order')
      .select('riderId')
      .eq('id', orderId)
      .single();

    if (existingAssignment?.riderId && existingAssignment.riderId !== riderId) {
      return new Response(JSON.stringify({ error: 'Order already assigned to another rider' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Assign rider to order
    const { error: updateError } = await supabase
      .from('Order')
      .update({
        riderId: riderId,
      })
      .eq('id', orderId);

    if (updateError) {
      return new Response(JSON.stringify({ error: 'Failed to assign order', details: updateError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Update order alert status
    await supabase
      .from('OrderAlert')
      .update({ status: 'ACCEPTED' })
      .eq('id', alert.id);

    // Get rider details from delivery_partners
    const { data: rider } = await supabase
      .from('delivery_partners')
      .select('id, name, phone')
      .eq('id', riderId)
      .single();

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
          title: 'Rider Assigned! 🚴',
          body: `${rider?.name || 'A rider'} is on the way to pick up order #${order.orderNumber}`,
          data: {
            type: 'RIDER_ASSIGNED',
            orderId: order.id,
            riderId: riderId,
            riderName: rider?.name || '',
            riderPhone: rider?.phone || '',
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

    // Send notification to customer
    const { data: orderForCustomer } = await supabase
      .from('Order')
      .select('userId')
      .eq('id', orderId)
      .single();

    if (orderForCustomer?.userId) {
      const { data: customerTokens } = await supabase
        .from('DeviceToken')
        .select('token')
        .eq('userId', orderForCustomer.userId);

      if (customerTokens && customerTokens.length > 0) {
        const messages = customerTokens.map(dt => ({
          to: dt.token,
          sound: 'default',
          title: 'Rider Assigned! 🚴',
          body: `A delivery partner has been assigned to your order #${order.orderNumber}`,
          data: {
            type: 'RIDER_ASSIGNED',
            orderId: order.id,
            riderId: riderId,
            riderName: rider?.name || '',
            riderPhone: rider?.phone || '',
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

    // Calculate distance between store and delivery location
    const storeData = Array.isArray(order.store) ? order.store[0] : order.store;
    const userData = Array.isArray(order.user) ? order.user[0] : order.user;
    
    let distanceKm = 0;
    if (storeData?.latitude && storeData?.longitude && order.deliveryLat && order.deliveryLng) {
      // Haversine formula
      const R = 6371; // Earth's radius in km
      const dLat = (order.deliveryLat - storeData.latitude) * Math.PI / 180;
      const dLng = (order.deliveryLng - storeData.longitude) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(storeData.latitude * Math.PI / 180) * Math.cos(order.deliveryLat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distanceKm = Math.round(R * c * 10) / 10;
    }
    
    // Calculate earnings (10% of order value, minimum ₹20)
    const earnings = Math.max(Math.round(order.totalAmount * 0.1), 20);

    return new Response(JSON.stringify({ 
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        otpCode: order.otpCode,
        deliveryAddress: order.deliveryAddress,
        deliveryLat: order.deliveryLat,
        deliveryLng: order.deliveryLng,
        // Store details (from Store table - updated location)
        store_id: storeData?.id || '',
        store_name: storeData?.name || '',
        store_address: storeData?.address || '',
        store_lat: storeData?.latitude || 0,
        store_lng: storeData?.longitude || 0,
        // Customer details
        customer_id: userData?.id || '',
        customer_name: userData?.name || 'Customer',
        customer_phone: userData?.phone || '',
        customer_address: order.deliveryAddress || '',
        customer_lat: order.deliveryLat || 0,
        customer_lng: order.deliveryLng || 0,
        // Calculated fields
        distance_km: distanceKm,
        earnings: earnings,
        // Single verification code for all apps
        verification_code: order.otpCode || '',
        // Order items
        items: orderItems || [],
        // Rider info
        rider: rider,
      },
      message: 'Order accepted successfully'
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
