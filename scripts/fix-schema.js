const { Client } = require('pg');

async function fixSchema() {
  const client = new Client({
    connectionString: 'postgresql://postgres.sqtkfyfwrbadfpfxkhzp:Supabaselogin@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connect_timeout=30',
  });

  await client.connect();
  console.log('Connected to database');

  // Add missing columns
  const columns = [
    { table: 'User', column: 'isBlocked', type: 'BOOLEAN DEFAULT false' },
    { table: 'Store', column: 'phone', type: 'VARCHAR(255)' },
    { table: 'Store', column: 'gstNumber', type: 'VARCHAR(255)' },
    { table: 'Store', column: 'isApproved', type: 'BOOLEAN DEFAULT true' },
    { table: 'Store', column: 'isDisabled', type: 'BOOLEAN DEFAULT false' },
  ];

  for (const col of columns) {
    try {
      await client.query(`ALTER TABLE "${col.table}" ADD COLUMN IF NOT EXISTS "${col.column}" ${col.type}`);
      console.log(`✓ Added ${col.table}.${col.column}`);
    } catch (e) {
      console.log(`  ${col.table}.${col.column}: ${e.message}`);
    }
  }

  // Now check the user and store data
  console.log('\n=== Checking User 919019829154 ===\n');
  
  const userRes = await client.query(`SELECT id, phone, role FROM "User" WHERE phone = '919019829154'`);
  console.log('User:', userRes.rows[0] || 'NOT FOUND');

  if (userRes.rows[0]) {
    const userId = userRes.rows[0].id;
    
    const storeRes = await client.query(`SELECT id, name, "ownerId" FROM "Store" WHERE "ownerId" = $1`, [userId]);
    console.log('Store:', storeRes.rows[0] || 'NOT FOUND');

    if (storeRes.rows[0]) {
      const storeId = storeRes.rows[0].id;
      
      const prodRes = await client.query(`SELECT COUNT(*) as count FROM "Product" WHERE "storeId" = $1`, [storeId]);
      const orderRes = await client.query(`SELECT COUNT(*) as count FROM "Order" WHERE "storeId" = $1`, [storeId]);
      
      console.log('Products:', prodRes.rows[0].count);
      console.log('Orders:', orderRes.rows[0].count);
    }
  }

  await client.end();
  console.log('\nDone!');
}

fixSchema().catch(console.error);
