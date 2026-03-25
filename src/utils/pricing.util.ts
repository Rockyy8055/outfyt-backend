/**
 * Delivery Pricing Engine for Outfyt
 * Calculates all financial values based on distance
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 - Latitude of point 1
 * @param lng1 - Longitude of point 1
 * @param lat2 - Latitude of point 2
 * @param lng2 - Longitude of point 2
 * @returns Distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return Math.round(distance * 10) / 10; // Round to 1 decimal place
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Calculate customer delivery fee
 * Formula: IF distance ≤ 1 km → ₹25, ELSE → 25 + (distance × 6.5)
 */
export function calculateDeliveryFee(distanceKm: number): number {
  if (distanceKm <= 1) {
    return 25;
  }
  return Math.round(25 + (distanceKm * 6.5));
}

/**
 * Calculate rider payout
 * Formula: base ₹30 + (distance × 7)
 */
export function calculateRiderEarning(distanceKm: number): number {
  return Math.round(30 + (distanceKm * 7));
}

/**
 * Calculate platform delivery margin
 * Can be negative during growth phase
 */
export function calculateDeliveryMargin(deliveryFee: number, riderEarning: number): number {
  return deliveryFee - riderEarning;
}

/**
 * Calculate commission amount
 * Default: 15% of product amount
 */
export function calculateCommission(productAmount: number, commissionPercent: number = 15): number {
  return Math.round(productAmount * (commissionPercent / 100));
}

/**
 * Calculate GST on platform fee and packing charge
 * GST = 5% of (platformFee + packingCharge)
 */
export function calculateGst(platformFee: number, packingCharge: number, gstPercent: number = 5): number {
  return Math.round((platformFee + packingCharge) * (gstPercent / 100));
}

/**
 * Calculate store earning after commission
 */
export function calculateStoreEarning(productAmount: number, commissionAmount: number): number {
  return productAmount - commissionAmount;
}

/**
 * Calculate platform earning
 * commissionAmount + platformFee + deliveryMargin
 */
export function calculatePlatformEarning(
  commissionAmount: number,
  platformFee: number,
  deliveryMargin: number
): number {
  return commissionAmount + platformFee + deliveryMargin;
}

/**
 * Calculate total order amount for customer
 * productAmount + deliveryFee + platformFee + packingCharge + gstAmount
 */
export function calculateTotalAmount(
  productAmount: number,
  deliveryFee: number,
  platformFee: number,
  packingCharge: number,
  gstAmount: number
): number {
  return productAmount + deliveryFee + platformFee + packingCharge + gstAmount;
}

/**
 * Complete order financial breakdown
 */
export interface OrderFinancials {
  distanceKm: number;
  productAmount: number;
  deliveryFee: number;
  riderEarning: number;
  deliveryMargin: number;
  commissionAmount: number;
  platformFee: number;
  packingCharge: number;
  gstAmount: number;
  storeEarning: number;
  platformEarning: number;
  totalAmount: number;
}

/**
 * Calculate complete order financial breakdown
 */
export function calculateOrderFinancials(
  productAmount: number,
  storeLat: number,
  storeLng: number,
  deliveryLat: number,
  deliveryLng: number,
  platformFee: number = 15,
  packingCharge: number = 20,
  commissionPercent: number = 15
): OrderFinancials {
  // Step 1: Calculate distance
  const distanceKm = calculateDistance(storeLat, storeLng, deliveryLat, deliveryLng);
  
  // Step 2: Calculate delivery fee for customer
  const deliveryFee = calculateDeliveryFee(distanceKm);
  
  // Step 3: Calculate rider payout
  const riderEarning = calculateRiderEarning(distanceKm);
  
  // Step 4: Calculate delivery margin
  const deliveryMargin = calculateDeliveryMargin(deliveryFee, riderEarning);
  
  // Step 5: Calculate commission
  const commissionAmount = calculateCommission(productAmount, commissionPercent);
  
  // Step 6: Calculate GST
  const gstAmount = calculateGst(platformFee, packingCharge);
  
  // Step 7: Calculate store earning
  const storeEarning = calculateStoreEarning(productAmount, commissionAmount);
  
  // Step 8: Calculate platform earning
  const platformEarning = calculatePlatformEarning(commissionAmount, platformFee, deliveryMargin);
  
  // Step 9: Calculate total amount
  const totalAmount = calculateTotalAmount(
    productAmount,
    deliveryFee,
    platformFee,
    packingCharge,
    gstAmount
  );
  
  return {
    distanceKm,
    productAmount,
    deliveryFee,
    riderEarning,
    deliveryMargin,
    commissionAmount,
    platformFee,
    packingCharge,
    gstAmount,
    storeEarning,
    platformEarning,
    totalAmount,
  };
}

/**
 * Validate order financials
 */
export function validateOrderFinancials(financials: OrderFinancials): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Verify total amount matches sum
  const expectedTotal = 
    financials.productAmount + 
    financials.deliveryFee + 
    financials.platformFee + 
    financials.packingCharge + 
    financials.gstAmount;
  
  if (Math.abs(expectedTotal - financials.totalAmount) > 1) {
    errors.push(`Total amount mismatch: expected ${expectedTotal}, got ${financials.totalAmount}`);
  }
  
  // Verify store earning
  const expectedStoreEarning = financials.productAmount - financials.commissionAmount;
  if (Math.abs(expectedStoreEarning - financials.storeEarning) > 1) {
    errors.push(`Store earning mismatch: expected ${expectedStoreEarning}, got ${financials.storeEarning}`);
  }
  
  // Verify rider earning is realistic (minimum ₹30)
  if (financials.riderEarning < 30) {
    errors.push(`Rider earning too low: ${financials.riderEarning}`);
  }
  
  // Verify delivery fee increases with distance
  if (financials.distanceKm > 1 && financials.deliveryFee <= 25) {
    errors.push(`Delivery fee should be higher for distance ${financials.distanceKm}km`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
