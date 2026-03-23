import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface StoreWithDistance {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  rating: number;
  totalOrders: number;
  category: string | null;
  tags: string[];
  distance: number;
  score?: number;
}

export interface ProductWithScore {
  id: string;
  name: string;
  price: number;
  images: string[];
  category: string | null;
  rating: number;
  totalSold: number;
  isTrending: boolean;
  isNew: boolean;
  storeId: string;
  storeName: string;
  score: number;
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== HOME FEED API ====================
  async getHomeFeed(userId: string, lat: number, lng: number) {
    const [nearbyStores, recommendedStores, categories, filters] = await Promise.all([
      this.getNearbyStores(lat, lng, 30),
      this.getRecommendedStores(userId, lat, lng),
      this.getCategories(),
      this.getFilters(),
    ]);

    return {
      nearbyStores,
      recommendedStores,
      categories,
      filters,
    };
  }

  // ==================== NEARBY STORES (HAVERSINE) ====================
  async getNearbyStores(lat: number, lng: number, radiusKm: number = 30): Promise<StoreWithDistance[]> {
    const stores = await this.prisma.$queryRaw<StoreWithDistance[]>`
      SELECT 
        id, name, latitude, longitude, address, rating, "totalOrders", category, tags,
        (
          6371 * acos(
            cos(radians(${lat}))
            * cos(radians(latitude))
            * cos(radians(longitude) - radians(${lng}))
            + sin(radians(${lat}))
            * sin(radians(latitude))
          )
        ) AS distance
      FROM "Store"
      WHERE "isApproved" = true AND "isDisabled" = false
      HAVING distance < ${radiusKm}
      ORDER BY distance ASC
      LIMIT 20
    `;

    // Round distance to 2 decimal places
    return stores.map(s => ({
      ...s,
      distance: Math.round(s.distance * 100) / 100,
    }));
  }

  // ==================== RECOMMENDATION ALGORITHM ====================
  async getRecommendedStores(userId: string, lat: number, lng: number): Promise<StoreWithDistance[]> {
    // Get all approved stores with distance
    const stores = await this.prisma.$queryRaw<StoreWithDistance[]>`
      SELECT 
        id, name, latitude, longitude, address, rating, "totalOrders", category, tags,
        (
          6371 * acos(
            cos(radians(${lat}))
            * cos(radians(latitude))
            * cos(radians(longitude) - radians(${lng}))
            + sin(radians(${lat}))
            * sin(radians(latitude))
          )
        ) AS distance
      FROM "Store"
      WHERE "isApproved" = true AND "isDisabled" = false
    `;

    // Get user preferences from past orders and activities
    const userPreferences = await this.getUserPreferences(userId);

    // Calculate scores for each store
    const scoredStores = stores.map(store => {
      const score = this.calculateStoreScore(store, userPreferences);
      return { ...store, score, distance: Math.round(store.distance * 100) / 100 };
    });

    // Sort by score descending
    scoredStores.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Return top 10
    return scoredStores.slice(0, 10);
  }

  private calculateStoreScore(
    store: StoreWithDistance,
    userPreferences: { preferredCategories: string[]; orderedStoreIds: string[] },
  ): number {
    // Rating score (normalized to 0-1, rating is 0-5)
    const ratingScore = (store.rating || 3.5) / 5;

    // Popularity score (normalized, using log scale for orders)
    const popularityScore = Math.log10((store.totalOrders || 0) + 1) / 4; // Max around 4 for 10000 orders

    // Distance score (inverse, closer is better)
    const maxDistance = 30; // km
    const distanceScore = Math.max(0, 1 - (store.distance / maxDistance));

    // Recency score (newer stores get boost)
    const recencyScore = 0.5; // Default, could be calculated from createdAt

    // User preference score
    let preferenceScore = 0;
    if (store.category && userPreferences.preferredCategories.includes(store.category)) {
      preferenceScore = 1;
    }
    if (userPreferences.orderedStoreIds.includes(store.id)) {
      preferenceScore += 0.5;
    }

    // Final weighted score
    const score =
      ratingScore * 0.3 +
      popularityScore * 0.25 +
      distanceScore * 0.25 +
      recencyScore * 0.1 +
      Math.min(preferenceScore, 1) * 0.1;

    return Math.round(score * 1000) / 1000;
  }

  private async getUserPreferences(userId: string): Promise<{
    preferredCategories: string[];
    orderedStoreIds: string[];
  }> {
    // Get categories from past orders
    const orders = await this.prisma.order.findMany({
      where: { userId },
      select: { storeId: true, store: { select: { category: true } } },
      take: 20,
    });

    const orderedStoreIds = [...new Set(orders.map(o => o.storeId))];
    const preferredCategories = [...new Set(orders.map(o => o.store?.category).filter(Boolean))] as string[];

    // Get categories from user activities (views/clicks)
    const activities = await this.prisma.userActivity.findMany({
      where: { userId, activityType: { in: ['VIEW', 'CLICK'] } },
      select: { storeId: true },
      take: 50,
    });

    const viewedStoreIds = [...new Set(activities.map(a => a.storeId).filter(Boolean))] as string[];

    // Get categories of viewed stores
    if (viewedStoreIds.length > 0) {
      const viewedStores = await this.prisma.store.findMany({
        where: { id: { in: viewedStoreIds } },
        select: { category: true },
      });
      viewedStores.forEach(s => {
        if (s.category) preferredCategories.push(s.category);
      });
    }

    return {
      preferredCategories: [...new Set(preferredCategories)],
      orderedStoreIds,
    };
  }

  // ==================== CATEGORIES API ====================
  async getCategories() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true, icon: true },
    });

    // If no categories exist, return defaults
    if (categories.length === 0) {
      return [
        { id: 'default-men', name: 'Men', slug: 'men', icon: '👔' },
        { id: 'default-women', name: 'Women', slug: 'women', icon: '👗' },
        { id: 'default-kids', name: 'Kids', slug: 'kids', icon: '🧒' },
        { id: 'default-trending', name: 'Trending', slug: 'trending', icon: '🔥' },
        { id: 'default-new', name: 'New', slug: 'new', icon: '✨' },
      ];
    }

    return categories;
  }

  // ==================== FILTERS API ====================
  async getFilters() {
    return [
      { id: 'trending', name: 'Trending', slug: 'trending', icon: '🔥' },
      { id: 'top-rated', name: 'Top Rated', slug: 'top-rated', icon: '⭐' },
      { id: 'nearby', name: 'Nearby', slug: 'nearby', icon: '📍' },
      { id: 'new', name: 'New', slug: 'new', icon: '✨' },
    ];
  }

  // ==================== SEARCH API ====================
  async search(query: string, lat?: number, lng?: number) {
    const searchTerm = query.toLowerCase().trim();

    if (!searchTerm) {
      return { stores: [], products: [] };
    }

    // Search stores
    const stores = await this.prisma.store.findMany({
      where: {
        isApproved: true,
        isDisabled: false,
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { category: { contains: searchTerm, mode: 'insensitive' } },
          { tags: { has: searchTerm } },
        ],
      },
      take: 10,
      select: {
        id: true,
        name: true,
        address: true,
        rating: true,
        totalOrders: true,
        category: true,
        tags: true,
      },
    });

    // Search products
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: searchTerm, mode: 'insensitive' } },
          { category: { contains: searchTerm, mode: 'insensitive' } },
          { color: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      take: 20,
      select: {
        id: true,
        name: true,
        price: true,
        images: true,
        category: true,
        rating: true,
        totalSold: true,
        isTrending: true,
        isNew: true,
        storeId: true,
      },
    });

    // Get store names for products
    const storeIds = [...new Set(products.map(p => p.storeId))];
    const storesData = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true },
    });
    const storeMap = new Map(storesData.map(s => [s.id, s.name]));

    // Track search query for trending
    await this.trackSearchQuery(searchTerm);

    // Add distance to stores if lat/lng provided
    let storesWithDistance = stores;
    if (lat !== undefined && lng !== undefined) {
      storesWithDistance = stores.map(store => ({
        ...store,
        distance: this.calculateSimpleDistance(lat, lng, store as any),
      }));
    }

    return {
      stores: storesWithDistance,
      products: products.map(p => ({
        ...p,
        storeName: storeMap.get(p.storeId) || '',
      })),
    };
  }

  private calculateSimpleDistance(lat1: number, lng1: number, store: { latitude?: number; longitude?: number }): number {
    // This is a fallback - real distance calculated in SQL
    return 0;
  }

  private async trackSearchQuery(query: string) {
    try {
      await this.prisma.searchSuggestion.upsert({
        where: { query },
        create: { query, count: 1 },
        update: {
          count: { increment: 1 },
          lastSearched: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn('Failed to track search query');
    }
  }

  // ==================== DISCOVER API ====================
  async getDiscover(userId: string, lat?: number, lng?: number) {
    const [suggestions, trendingSearches, trendingProducts, newProducts] = await Promise.all([
      this.getSuggestions(userId),
      this.getTrendingSearches(),
      this.getTrendingProducts(),
      this.getNewProducts(),
    ]);

    return {
      suggestions,
      trendingSearches,
      trendingProducts,
      newProducts,
    };
  }

  private async getSuggestions(userId: string): Promise<string[]> {
    // Get user's recent searches
    const activities = await this.prisma.userActivity.findMany({
      where: { userId, activityType: 'SEARCH', searchQuery: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { searchQuery: true },
    });

    const recentSearches = activities.map(a => a.searchQuery).filter(Boolean) as string[];

    // Add trending searches if not enough recent
    if (recentSearches.length < 5) {
      const trending = await this.getTrendingSearches();
      recentSearches.push(...trending.slice(0, 5 - recentSearches.length));
    }

    return recentSearches;
  }

  private async getTrendingSearches(): Promise<string[]> {
    const suggestions = await this.prisma.searchSuggestion.findMany({
      where: { isTrending: true },
      orderBy: { count: 'desc' },
      take: 10,
      select: { query: true },
    });

    return suggestions.map(s => s.query);
  }

  private async getTrendingProducts(): Promise<ProductWithScore[]> {
    const products = await this.prisma.product.findMany({
      where: { isTrending: true },
      take: 10,
      select: {
        id: true,
        name: true,
        price: true,
        images: true,
        category: true,
        rating: true,
        totalSold: true,
        isTrending: true,
        isNew: true,
        storeId: true,
        store: { select: { name: true } },
      },
    });

    return products.map(p => ({
      ...p,
      storeName: p.store?.name || '',
      score: (p.rating / 5) * 0.5 + Math.log10((p.totalSold || 0) + 1) / 4 * 0.5,
    }));
  }

  private async getNewProducts(): Promise<ProductWithScore[]> {
    const products = await this.prisma.product.findMany({
      where: { isNew: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        price: true,
        images: true,
        category: true,
        rating: true,
        totalSold: true,
        isTrending: true,
        isNew: true,
        storeId: true,
        store: { select: { name: true } },
      },
    });

    return products.map(p => ({
      ...p,
      storeName: p.store?.name || '',
      score: 0.8, // High score for new products
    }));
  }

  // ==================== FILTERED STORES ====================
  async getFilteredStores(filter: string, lat: number, lng: number): Promise<StoreWithDistance[]> {
    switch (filter) {
      case 'trending':
        return this.getTrendingStores(lat, lng);
      case 'top-rated':
        return this.getTopRatedStores(lat, lng);
      case 'nearby':
        return this.getNearbyStores(lat, lng, 10);
      case 'new':
        return this.getNewStores(lat, lng);
      default:
        return this.getNearbyStores(lat, lng);
    }
  }

  private async getTrendingStores(lat: number, lng: number): Promise<StoreWithDistance[]> {
    const stores = await this.prisma.$queryRaw<StoreWithDistance[]>`
      SELECT 
        id, name, latitude, longitude, address, rating, "totalOrders", category, tags,
        (
          6371 * acos(
            cos(radians(${lat}))
            * cos(radians(latitude))
            * cos(radians(longitude) - radians(${lng}))
            + sin(radians(${lat}))
            * sin(radians(latitude))
          )
        ) AS distance
      FROM "Store"
      WHERE "isApproved" = true AND "isDisabled" = false
      ORDER BY "totalOrders" DESC
      LIMIT 20
    `;

    return stores.map(s => ({ ...s, distance: Math.round(s.distance * 100) / 100 }));
  }

  private async getTopRatedStores(lat: number, lng: number): Promise<StoreWithDistance[]> {
    const stores = await this.prisma.$queryRaw<StoreWithDistance[]>`
      SELECT 
        id, name, latitude, longitude, address, rating, "totalOrders", category, tags,
        (
          6371 * acos(
            cos(radians(${lat}))
            * cos(radians(latitude))
            * cos(radians(longitude) - radians(${lng}))
            + sin(radians(${lat}))
            * sin(radians(latitude))
          )
        ) AS distance
      FROM "Store"
      WHERE "isApproved" = true AND "isDisabled" = false
      ORDER BY rating DESC
      LIMIT 20
    `;

    return stores.map(s => ({ ...s, distance: Math.round(s.distance * 100) / 100 }));
  }

  private async getNewStores(lat: number, lng: number): Promise<StoreWithDistance[]> {
    const stores = await this.prisma.$queryRaw<StoreWithDistance[]>`
      SELECT 
        id, name, latitude, longitude, address, rating, "totalOrders", category, tags,
        (
          6371 * acos(
            cos(radians(${lat}))
            * cos(radians(latitude))
            * cos(radians(longitude) - radians(${lng}))
            + sin(radians(${lat}))
            * sin(radians(latitude))
          )
        ) AS distance
      FROM "Store"
      WHERE "isApproved" = true AND "isDisabled" = false
      ORDER BY "createdAt" DESC
      LIMIT 20
    `;

    return stores.map(s => ({ ...s, distance: Math.round(s.distance * 100) / 100 }));
  }

  // ==================== USER ACTIVITY TRACKING ====================
  async trackActivity(
    userId: string,
    activityType: 'VIEW' | 'CLICK' | 'ORDER' | 'SEARCH',
    data: { storeId?: string; productId?: string; searchQuery?: string },
  ) {
    await this.prisma.userActivity.create({
      data: {
        userId,
        activityType,
        storeId: data.storeId,
        productId: data.productId,
        searchQuery: data.searchQuery,
      },
    });
  }

  // ==================== STORE PRODUCTS ====================
  async getStoreProducts(storeId: string, filter?: string) {
    const where: any = { storeId };

    if (filter === 'trending') {
      where.isTrending = true;
    } else if (filter === 'new') {
      where.isNew = true;
    }

    const products = await this.prisma.product.findMany({
      where,
      orderBy: filter === 'trending' ? { totalSold: 'desc' } : { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        price: true,
        images: true,
        category: true,
        rating: true,
        totalSold: true,
        isTrending: true,
        isNew: true,
        inventory: { select: { size: true, stock: true } },
      },
    });

    return products;
  }
}
