import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Haversine formula to calculate distance between two points
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
    const { storeId, orderId, radius = 25 } = body;
    
    if (!storeId) {
      return new Response(JSON.stringify({ error: 'Missing storeId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get store location
    const { data: store, error: storeError } = await supabase
      .from('Store')
      .select('id, name, address, latitude, longitude')
      .eq('id', storeId)
      .single();

    if (storeError || !store || !store.latitude || !store.longitude) {
      return new Response(JSON.stringify({ error: 'Store not found or missing location' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Get all online delivery partners with location from User table
    const { data: riders, error: ridersError } = await supabase
      .from('User')
      .select('id, name, phone, currentLat, currentLng, rating')
      .eq('role', 'RIDER')
      .eq('isOnline', true)
      .not('currentLat', 'is', null)
      .not('currentLng', 'is', null);

    if (ridersError) {
      return new Response(JSON.stringify({ error: 'Failed to fetch riders', details: ridersError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Filter riders within radius and calculate distance
    const nearbyRiders = (riders || [])
      .map((rider: any) => {
        const distance = calculateDistance(
          store.latitude,
          store.longitude,
          rider.currentLat,
          rider.currentLng
        );
        return {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          latitude: rider.currentLat,
          longitude: rider.currentLng,
          distance: Math.round(distance * 10) / 10, // Round to 1 decimal
          rating: rider.rating,
        };
      })
      .filter((rider: any) => rider.distance <= radius)
      .sort((a: any, b: any) => a.distance - b.distance);

    // Get order details if orderId provided
    let order = null;
    if (orderId) {
      const { data: orderData } = await supabase
        .from('Order')
        .select(`
          id,
          orderNumber,
          totalAmount,
          deliveryAddress,
          deliveryLat,
          deliveryLng,
          otpCode,
          handoverCode,
          store:storeId (id, name, address, latitude, longitude)
        `)
        .eq('id', orderId)
        .single();
      order = orderData;
    }

    return new Response(JSON.stringify({ 
      success: true,
      store: {
        id: store.id,
        name: store.name,
        address: store.address,
        latitude: store.latitude,
        longitude: store.longitude,
      },
      order,
      nearbyRiders,
      totalRiders: nearbyRiders.length,
      radius
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
