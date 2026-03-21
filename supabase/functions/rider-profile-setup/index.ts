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
    const { 
      phone, 
      name, 
      email,
      vehicleType,
      vehicleNumber,
      aadharNumber,
      panNumber,
      address,
      city,
      pincode,
      emergencyContact,
      fcmToken 
    } = body;
    
    if (!phone || !name) {
      return new Response(JSON.stringify({ error: 'Phone and name are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('User')
      .select('id, phone, name')
      .eq('phone', phone)
      .maybeSingle();

    if (existingUser) {
      // User exists - update profile if needed
      const { data: updatedUser, error: updateError } = await supabase
        .from('User')
        .update({
          name,
          email: email || null,
          role: 'RIDER',
          isOnline: false,
        })
        .eq('id', existingUser.id)
        .select()
        .single();

      if (updateError) {
        return new Response(JSON.stringify({ error: 'Failed to update profile', details: updateError.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Store FCM token if provided
      if (fcmToken) {
        await supabase
          .from('DeviceToken')
          .upsert({
            userId: existingUser.id,
            token: fcmToken,
            updatedAt: new Date().toISOString(),
          }, { onConflict: 'token' });
      }

      // Create rider profile details if table exists
      try {
        await supabase
          .from('RiderProfile')
          .upsert({
            userId: existingUser.id,
            vehicleType,
            vehicleNumber,
            aadharNumber,
            panNumber,
            address,
            city,
            pincode,
            emergencyContact,
            isVerified: true,
            verifiedAt: new Date().toISOString(),
          }, { onConflict: 'userId' });
      } catch (e) {
        console.log('RiderProfile table may not exist:', e);
      }

      return new Response(JSON.stringify({ 
        success: true,
        user: {
          id: existingUser.id,
          phone: existingUser.phone,
          name,
          role: 'RIDER',
          isOnline: false,
        },
        isNewUser: false,
        message: 'Profile updated successfully'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('User')
      .insert({
        phone,
        name,
        email: email || null,
        role: 'RIDER',
        isOnline: false,
      })
      .select()
      .single();

    if (createError) {
      return new Response(JSON.stringify({ error: 'Failed to create user', details: createError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Store FCM token if provided
    if (fcmToken) {
      await supabase
        .from('DeviceToken')
        .insert({
          userId: newUser.id,
          token: fcmToken,
        });
    }

    // Create rider profile details
    try {
      await supabase
        .from('RiderProfile')
        .insert({
          userId: newUser.id,
          vehicleType,
          vehicleNumber,
          aadharNumber,
          panNumber,
          address,
          city,
          pincode,
          emergencyContact,
          isVerified: true,
          verifiedAt: new Date().toISOString(),
        });
    } catch (e) {
      console.log('RiderProfile table may not exist:', e);
    }

    // Create initial rider location entry
    try {
      await supabase
        .from('RiderLocation')
        .insert({
          riderId: newUser.id,
          latitude: 0,
          longitude: 0,
        });
    } catch (e) {
      console.log('RiderLocation insert error:', e);
    }

    return new Response(JSON.stringify({ 
      success: true,
      user: {
        id: newUser.id,
        phone: newUser.phone,
        name: newUser.name,
        role: 'RIDER',
        isOnline: false,
      },
      isNewUser: true,
      message: 'Profile created successfully'
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
