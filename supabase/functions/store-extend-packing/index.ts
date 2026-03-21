import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    
    // Get auth user from request
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { orderId, additionalMinutes } = await req.json();
    
    if (!orderId || !additionalMinutes) {
      return new Response(JSON.stringify({ error: 'Missing orderId or additionalMinutes' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get order and verify store ownership
    const { data: order, error: orderError } = await supabase
      .from('Order')
      .select('id, storeId, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get store and verify ownership
    const { data: store, error: storeError } = await supabase
      .from('Store')
      .select('id, ownerId')
      .eq('id', order.storeId)
      .single();

    if (storeError || !store) {
      return new Response(JSON.stringify({ error: 'Store not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (store.ownerId !== user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (order.status !== 'PACKING' && order.status !== 'ACCEPTED') {
      return new Response(JSON.stringify({ error: 'Can only extend packing for PACKING or ACCEPTED orders' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update packing started at time (extend by adding time)
    const { data: currentOrder } = await supabase
      .from('Order')
      .select('packingStartedAt')
      .eq('id', orderId)
      .single();

    const currentPackingStarted = currentOrder?.packingStartedAt 
      ? new Date(currentOrder.packingStartedAt) 
      : new Date();
    
    // Add additional minutes to the packing start time (this effectively extends the deadline)
    const newPackingStarted = new Date(currentPackingStarted.getTime() - additionalMinutes * 60 * 1000);

    const { error: updateError } = await supabase
      .from('Order')
      .update({
        packingStartedAt: newPackingStarted.toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to extend packing time' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      success: true,
      newPackingStartedAt: newPackingStarted.toISOString(),
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
