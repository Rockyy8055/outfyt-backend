import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Seed Admin User - force update password to ensure it's bcrypt hashed correctly
  const adminPassword = await bcrypt.hash('outfytlogin@01', 12);
  const admin = await prisma.admin.upsert({
    where: { email: 'shreysm8055@gmail.com' },
    create: {
      email: 'shreysm8055@gmail.com',
      name: 'Super Admin',
      password: adminPassword,
      role: 'admin',
      status: 'active',
    },
    update: {
      password: adminPassword,
      status: 'active',
    },
  });
  console.log('✅ Admin user ready:', admin.email);

  // Seed Categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'men' },
      create: { name: 'Men', slug: 'men', icon: '👔', sortOrder: 1 },
      update: {},
    }),
    prisma.category.upsert({
      where: { slug: 'women' },
      create: { name: 'Women', slug: 'women', icon: '👗', sortOrder: 2 },
      update: {},
    }),
    prisma.category.upsert({
      where: { slug: 'kids' },
      create: { name: 'Kids', slug: 'kids', icon: '🧒', sortOrder: 3 },
      update: {},
    }),
    prisma.category.upsert({
      where: { slug: 'trending' },
      create: { name: 'Trending', slug: 'trending', icon: '🔥', sortOrder: 0 },
      update: {},
    }),
    prisma.category.upsert({
      where: { slug: 'new' },
      create: { name: 'New', slug: 'new', icon: '✨', sortOrder: 0 },
      update: {},
    }),
  ]);

  console.log('✅ Categories seeded:', categories.length);

  // Seed Search Suggestions
  const suggestions = await Promise.all([
    prisma.searchSuggestion.upsert({
      where: { query: 't-shirts' },
      create: { query: 't-shirts', count: 100, isTrending: true },
      update: {},
    }),
    prisma.searchSuggestion.upsert({
      where: { query: 'jeans' },
      create: { query: 'jeans', count: 85, isTrending: true },
      update: {},
    }),
    prisma.searchSuggestion.upsert({
      where: { query: 'dresses' },
      create: { query: 'dresses', count: 75, isTrending: true },
      update: {},
    }),
    prisma.searchSuggestion.upsert({
      where: { query: 'sneakers' },
      create: { query: 'sneakers', count: 60, isTrending: true },
      update: {},
    }),
    prisma.searchSuggestion.upsert({
      where: { query: 'kurta' },
      create: { query: 'kurta', count: 50, isTrending: true },
      update: {},
    }),
  ]);

  console.log('✅ Search suggestions seeded:', suggestions.length);

  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
