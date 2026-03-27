-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('STORE', 'RIDER');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('ORDER_EARNING', 'WITHDRAWAL', 'REFUND', 'BONUS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds customerName, customerPhone, storeName fields to Order table
-- and creates the get_nearby_online_stores RPC function

-- =====================================================
-- 1. ADD CUSTOMER FIELDS TO ORDER TABLE
-- =====================================================
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "storeName" TEXT;

-- =====================================================
-- 2. BACKFILL EXISTING ORDERS WITH CUSTOMER/STORE DATA
-- =====================================================
UPDATE "Order" o
SET 
  "customerName" = u.name,
  "customerPhone" = u.phone,
  "storeName" = s.name
FROM "User" u, "Store" s
WHERE o."userId" = u.id 
  AND o."storeId" = s.id
  AND o."customerName" IS NULL;

-- =====================================================
-- 3. CREATE INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_store_location ON "Store"(latitude, longitude) 
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_store_approved ON "Store"("isApproved", "isDisabled");
CREATE INDEX IF NOT EXISTS idx_order_user ON "Order"("userId");
CREATE INDEX IF NOT EXISTS idx_order_store ON "Order"("storeId");
CREATE INDEX IF NOT EXISTS idx_order_status ON "Order"(status);
CREATE INDEX IF NOT EXISTS idx_order_created ON "Order"("createdAt");

-- =====================================================
-- 4. CREATE GET NEARBY ONLINE STORES RPC FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION get_nearby_online_stores(
  p_user_lat FLOAT,
  p_user_lng FLOAT,
  p_radius_km FLOAT DEFAULT 30
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  address TEXT,
  latitude FLOAT,
  longitude FLOAT,
  "isOnline" BOOLEAN,
  distance_km FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id::TEXT,
    s.name::TEXT,
    s.address::TEXT,
    s.latitude::FLOAT,
    s.longitude::FLOAT,
    COALESCE(s."isOnline", true) AS "isOnline",
    (
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(p_user_lat))
          * cos(radians(s.latitude))
          * cos(radians(s.longitude) - radians(p_user_lng))
          + sin(radians(p_user_lat))
          * sin(radians(s.latitude))
        ))
      )
    )::FLOAT AS distance_km
  FROM "Store" s
  WHERE 
    s.latitude IS NOT NULL 
    AND s.longitude IS NOT NULL
    AND s."isDisabled" = false
    AND s."isApproved" = true
    AND (
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(p_user_lat))
          * cos(radians(s.latitude))
          * cos(radians(s.longitude) - radians(p_user_lng))
          + sin(radians(p_user_lat))
          * sin(radians(s.latitude))
        ))
      )
    ) <= p_radius_km
  ORDER BY distance_km
  LIMIT 50;
END;
$$;

-- =====================================================
-- COMPLETE
-- =====================================================
SELECT 'Migration 003 applied successfully!' AS status;
