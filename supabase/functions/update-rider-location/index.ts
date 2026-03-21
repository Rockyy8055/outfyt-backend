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
    const { riderId, latitude, longitude, isOnline } = body;
    
    if (!riderId || latitude === undefined || longitude === undefined) {
      return new Response(JSON.stringify({ error: 'Missing riderId, latitude, or longitude' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Validate coordinates
    if (isNaN(latitude) || isNaN(longitude)) {
      return new Response(JSON.stringify({ error: 'Invalid coordinates' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Update delivery_partners table with location and online status
    const updateData: any = {
      current_latitude: latitude,
      current_longitude: longitude,
      location_updated_at: new Date().toISOString(),
    };
    
    if (isOnline !== undefined) {
      updateData.online_status = isOnline;
    }

    const { data: partnerData, error: partnerError } = await supabase
      .from('delivery_partners')
      .update(updateData)
      .eq('id', riderId)
      .select()
      .single();

    if (partnerError) {
      return new Response(JSON.stringify({ error: 'Failed to update location', details: partnerError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify({ 
      success: true,
      location: {
        latitude,
        longitude,
        isOnline: isOnline ?? partnerData?.online_status,
      },
      message: 'Location updated successfully'
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
