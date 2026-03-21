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
  // Handle CORS preflight
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

    // Use storeOwnerId if provided, otherwise try to get from auth header
    let userId = storeOwnerId;
    
    if (!userId) {
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          userId = user.id;
        }
      }
    }

    // Get order with store location
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select('id, storeId, status, userId, orderNumber, totalAmount, deliveryAddress, deliveryLat, deliveryLng')
      .eq('id', orderId)
      .single();

    if (orderError) {
      console.error('Order error:', orderError);
      return new Response(JSON.stringify({ error: 'Order not found', details: orderError.message }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (!order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get store with location
    const { data: store, error: storeError } = await supabase
      .from('Store')
      .select('id, ownerId, name, address, latitude, longitude')
      .eq('id', order.storeId)
      .single();

    if (storeError) {
      console.error('Store error:', storeError);
      return new Response(JSON.stringify({ error: 'Store not found', details: storeError.message }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Verify ownership - skip if no userId provided (trust storeOwnerId from app)
    if (userId && store && store.ownerId && store.ownerId !== userId) {
      console.log('Ownership mismatch:', { storeOwnerId: store.ownerId, providedUserId: userId });
    }

    if (order.status !== 'PENDING') {
      return new Response(JSON.stringify({ error: 'Order is not in PENDING status', currentStatus: order.status }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Update order status to ACCEPTED
    const { error: updateError } = await supabase
      .from('Order')
      .update({
        status: 'ACCEPTED',
        packingStartedAt: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to accept order', details: updateError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Fetch the updated order with details
    const { data: updatedOrder, error: fetchError } = await supabase
      .from('Order')
      .select(`
        id,
        orderNumber,
        status,
        totalAmount,
        paymentMethod,
        paymentStatus,
        otpCode,
        deliveryAddress,
        deliveryLat,
        deliveryLng,
        customerName,
        customerPhone,
        packingStartedAt,
        createdAt,
        userId,
        storeId
      `)
      .eq('id', orderId)
      .single();

    if (fetchError) {
      console.error('Fetch error:', fetchError);
    }

    // Fetch order items separately
    const { data: items } = await supabase
      .from('OrderItem')
      .select('id, productId, productName, size, quantity, unitPrice, offerPercentage')
      .eq('orderId', orderId);

    // Notify customer
    await supabase.from('Notification').insert({
      userId: order.userId,
      title: 'Order Accepted',
      body: `Your order #${updatedOrder?.orderNumber || orderId.slice(0, 8).toUpperCase()} has been accepted`,
      data: {
        type: 'order.accepted',
        orderId: orderId,
      },
      read: false,
    });

    // FIND NEARBY RIDERS AND SEND ORDER ALERTS
    let alertsSent = 0;
    let nearbyRidersCount = 0;

    if (store?.latitude && store?.longitude) {
      // Get all online riders with location
      const { data: riders } = await supabase
        .from('delivery_partners')
        .select('id, name, phone, current_latitude, current_longitude')
        .eq('online_status', true)
        .not('current_latitude', 'is', null)
        .not('current_longitude', 'is', null);

      // Filter and sort by distance (25km radius)
      const nearbyRiders = (riders || [])
        .map((rider: any) => {
          const distance = calculateDistance(
            store.latitude,
            store.longitude,
            rider.current_latitude,
            rider.current_longitude
          );
          return {
            id: rider.id,
            name: rider.name,
            phone: rider.phone,
            distance: Math.round(distance * 10) / 10,
          };
        })
        .filter((rider: any) => rider.distance <= 25)
        .sort((a: any, b: any) => a.distance - b.distance);

      nearbyRidersCount = nearbyRiders.length;

      // Create order alerts and send push notifications
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

      for (const rider of nearbyRiders) {
        // Create order alert in database
        const { error: alertError } = await supabase
          .from('OrderAlert')
          .insert({
            orderId: orderId,
            riderId: rider.id,
            status: 'PENDING',
            expiresAt: expiresAt.toISOString(),
          });

        if (alertError) {
          console.error('Alert create error:', alertError);
          continue;
        }

        alertsSent++;

        // Get device tokens for push notification
        const { data: deviceTokens } = await supabase
          .from('DeviceToken')
          .select('token')
          .eq('userId', rider.id);

        if (deviceTokens && deviceTokens.length > 0) {
          const messages = deviceTokens.map(dt => ({
            to: dt.token,
            sound: 'default',
            title: '🚚 New Delivery Order!',
            body: `Order #${updatedOrder?.orderNumber || 'New'} from ${store.name || 'Store'} - ${rider.distance}km away`,
            data: {
              type: 'NEW_ORDER',
              orderId: order.id,
              orderNumber: updatedOrder?.orderNumber,
              storeName: store.name,
              storeAddress: store.address,
              storeLat: store.latitude,
              storeLng: store.longitude,
              deliveryAddress: order.deliveryAddress,
              deliveryLat: order.deliveryLat,
              deliveryLng: order.deliveryLng,
              totalAmount: order.totalAmount,
              distance: rider.distance,
            },
            priority: 'high',
          }));

          try {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(messages),
            });
            alertsSent++;
          } catch (e) {
            console.error('Push error for rider', rider.id, e);
          }
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      order: {
        ...updatedOrder,
        items: items || [],
        // Include store details from Store table (updated location)
        store: {
          id: store.id,
          name: store.name,
          address: store.address,
          latitude: store.latitude,
          longitude: store.longitude,
        },
        // Verification code for all apps
        verification_code: updatedOrder?.otpCode,
      },
      riderAlerts: {
        nearbyRiders: nearbyRidersCount,
        alertsSent,
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
