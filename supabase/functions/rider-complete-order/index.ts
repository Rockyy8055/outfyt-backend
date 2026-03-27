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
    const { orderId, riderId, verificationCode, otpCode, riderLat, riderLng } = body;
    
    // Accept both verificationCode and otpCode for compatibility
    const code = verificationCode || otpCode;
    
    if (!orderId || !riderId) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Missing orderId or riderId' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get order details with customer location and rider earnings
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select(`
        id,
        orderNumber,
        status,
        totalAmount,
        otpCode,
        userId,
        storeId,
        deliveryLat,
        deliveryLng,
        deliveryAddress,
        riderEarning,
        distanceKm,
        store:storeId (id, name, address)
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
    const { data: orderCheck } = await supabase
      .from('Order')
      .select('riderId')
      .eq('id', orderId)
      .single();

    if (orderCheck?.riderId !== riderId) {
      return new Response(JSON.stringify({ error: 'Order not assigned to this rider' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if order is PICKED_UP or OUT_FOR_DELIVERY
    if (!['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      return new Response(JSON.stringify({ 
        error: 'Order not in delivery status', 
        currentStatus: order.status 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Geolocation verification - rider must be within 30m of customer location (GPS accuracy buffer)
    // TEMPORARILY DISABLED FOR TESTING - uncomment when ready for production
    // if (riderLat && riderLng && order.deliveryLat && order.deliveryLng) {
    //   const distanceToCustomer = calculateDistance(riderLat, riderLng, order.deliveryLat, order.deliveryLng);
    //   if (distanceToCustomer > 30) {
    //     return new Response(JSON.stringify({ 
    //       error: 'Please reach the customer location to confirm delivery',
    //       distanceToCustomer: Math.round(distanceToCustomer),
    //       requiredDistance: 30,
    //       customerLocation: { lat: order.deliveryLat, lng: order.deliveryLng },
    //       riderLocation: { lat: riderLat, lng: riderLng }
    //     }), {
    //       status: 400,
    //       headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    //     });
    //   }
    // }

    // Verify verification code (customer gives this code to rider)
    if (code && order.otpCode && code !== order.otpCode) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Invalid verification code' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Use pre-calculated rider earnings from Order table (30 + distance × 7)
    // Fallback to calculation if not available
    const earnings = order.riderEarning || Math.round(30 + ((order.distanceKm || 0) * 7));

    // Update order status to DELIVERED
    const { error: updateError } = await supabase
      .from('Order')
      .update({
        status: 'DELIVERED',
        deliveredAt: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      return new Response(JSON.stringify({ error: 'Failed to update order' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Add earnings to rider wallet
    const { data: existingWallet } = await supabase
      .from('RiderWallet')
      .select('*')
      .eq('riderId', riderId)
      .single();

    if (existingWallet) {
      await supabase
        .from('RiderWallet')
        .update({
          withdrawableBalance: existingWallet.withdrawableBalance + earnings,
          totalEarnings: existingWallet.totalEarnings + earnings,
          updatedAt: new Date().toISOString(),
        })
        .eq('riderId', riderId);
    } else {
      await supabase
        .from('RiderWallet')
        .insert({
          riderId,
          withdrawableBalance: earnings,
          totalEarnings: earnings,
        });
    }

    // Add transaction record
    await supabase
      .from('WalletTransaction')
      .insert({
        riderWalletId: existingWallet?.id,
        walletType: 'RIDER',
        type: 'DELIVERY_EARNING',
        amount: earnings,
        orderId,
        description: `Delivery completed - Order #${order.orderNumber}`,
      });

    // Update rider total deliveries
    await supabase.rpc('increment_total_deliveries', { rider_id: riderId }).catch(() => {
      // RPC might not exist, ignore error
    });

    // Send notification to customer
    const { data: customerTokens } = await supabase
      .from('DeviceToken')
      .select('token')
      .eq('userId', order.userId);

    if (customerTokens && customerTokens.length > 0) {
      const messages = customerTokens.map(dt => ({
        to: dt.token,
        sound: 'default',
        title: 'Order Delivered! 🎉',
        body: `Your order #${order.orderNumber} has been delivered successfully`,
        data: {
          type: 'ORDER_DELIVERED',
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

    // Send notification to store
    const storeData = Array.isArray(order.store) ? order.store[0] : order.store;
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
          title: 'Order Delivered! ✅',
          body: `Order #${order.orderNumber} has been delivered successfully`,
          data: {
            type: 'ORDER_DELIVERED',
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

    return new Response(JSON.stringify({ 
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: 'DELIVERED',
        totalAmount: order.totalAmount,
        earnings: Math.round(earnings * 100) / 100,
      },
      wallet: {
        earningsAdded: Math.round(earnings * 100) / 100,
      },
      message: 'Order delivered successfully! Earnings added to wallet.'
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
