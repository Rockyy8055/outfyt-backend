const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanupDuplicateUsers() {
  console.log('Starting duplicate user cleanup...\n');
  
  // Find all users with phone numbers
  const users = await prisma.user.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, role: true },
  });
  
  console.log(`Total users with phone: ${users.length}`);
  
  // Group by phone
  const phoneMap = new Map();
  for (const user of users) {
    if (!phoneMap.has(user.phone)) {
      phoneMap.set(user.phone, []);
    }
    phoneMap.get(user.phone).push(user);
  }
  
  // Find duplicates
  const duplicates = [];
  for (const [phone, userList] of phoneMap) {
    if (userList.length > 1) {
      duplicates.push({ phone, users: userList });
    }
  }
  
  console.log(`Found ${duplicates.length} duplicate phone numbers\n`);
  
  if (duplicates.length === 0) {
    console.log('No duplicates found. Database is clean!');
    await prisma.$disconnect();
    return;
  }
  
  // Process each duplicate
  for (const dup of duplicates) {
    console.log(`\nProcessing phone: ${dup.phone}`);
    console.log(`Users: ${dup.users.map(u => `${u.id} (${u.role})`).join(', ')}`);
    
    // Find which user has a store
    const storeChecks = await Promise.all(
      dup.users.map(async (u) => {
        const store = await prisma.store.findUnique({
          where: { ownerId: u.id },
          select: { id: true, name: true },
        });
        return { user: u, store };
      })
    );
    
    // Find the user with store (priority) or first user
    const withStore = storeChecks.find(sc => sc.store);
    const userToKeep = withStore ? withStore.user : dup.users[0];
    
    console.log(`User to keep: ${userToKeep.id} (${withStore ? 'has store: ' + withStore.store.name : 'no store'})`);
    
    // Delete other users
    const usersToDelete = dup.users.filter(u => u.id !== userToKeep.id);
    
    for (const userToDelete of usersToDelete) {
      console.log(`Deleting user: ${userToDelete.id}`);
      
      try {
        // First delete related records
        await prisma.deviceToken.deleteMany({ where: { userId: userToDelete.id } });
        await prisma.notification.deleteMany({ where: { userId: userToDelete.id } });
        
        // Delete the user
        await prisma.user.delete({ where: { id: userToDelete.id } });
        console.log(`✓ Deleted user: ${userToDelete.id}`);
      } catch (error) {
        console.log(`✗ Failed to delete user ${userToDelete.id}: ${error.message}`);
      }
    }
  }
  
  console.log('\n\nCleanup complete!');
  await prisma.$disconnect();
}

cleanupDuplicateUsers().catch(console.error);
