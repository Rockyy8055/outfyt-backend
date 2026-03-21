const { PrismaClient } = require('@prisma/client');

async function debug() {
  const prisma = new PrismaClient();
  
  console.log('=== DEBUGGING STORE DATA ===\n');
  
  try {
    // Get all STORE users
    const users = await prisma.user.findMany({
      where: { role: 'STORE' },
      select: { id: true, phone: true, name: true },
    });
    
    console.log('STORE Users:');
    users.forEach(u => console.log(`  ${u.id} | ${u.phone} | ${u.name || 'No name'}`));
    console.log('');
    
    // Get all stores
    const stores = await prisma.store.findMany({
      select: { id: true, name: true, ownerId: true },
    });
    
    console.log('Stores:');
    stores.forEach(s => console.log(`  ${s.id} | ${s.name} | owner: ${s.ownerId}`));
    console.log('');
    
    // Count products and orders per store
    for (const store of stores) {
      const products = await prisma.product.count({ where: { storeId: store.id } });
      const orders = await prisma.order.count({ where: { storeId: store.id } });
      const owner = users.find(u => u.id === store.ownerId);
      console.log(`Store "${store.name}": Products=${products}, Orders=${orders}, OwnerPhone=${owner?.phone || 'NOT FOUND'}`);
    }
    console.log('');
    
    // Show some products
    const products = await prisma.product.findMany({ take: 5, select: { name: true, storeId: true } });
    console.log('Sample Products:');
    products.forEach(p => console.log(`  ${p.name} | storeId: ${p.storeId}`));
    console.log('');
    
    // Show some orders
    const orders = await prisma.order.findMany({ take: 5, select: { id: true, status: true, storeId: true } });
    console.log('Sample Orders:');
    orders.forEach(o => console.log(`  ${o.id} | ${o.status} | storeId: ${o.storeId}`));
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

debug();
