-- =====================================================
-- OUTFYT ADMIN AUTHENTICATION SETUP
-- Run this in Supabase SQL Editor
-- =====================================================

-- =====================================================
-- 1. CREATE ADMINS TABLE (if not exists)
-- =====================================================
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'admin',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 2. ENABLE ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 3. RLS POLICIES FOR ADMINS TABLE
-- =====================================================

-- Admins can read their own data
CREATE POLICY "Admins can view own data"
ON admins FOR SELECT
USING (auth.uid()::text = id::text OR auth.jwt() ->> 'role' = 'admin');

-- Admins can update their own data
CREATE POLICY "Admins can update own data"
ON admins FOR UPDATE
USING (auth.uid()::text = id::text);

-- Only service role can insert (via trigger)
CREATE POLICY "Service role can insert admins"
ON admins FOR INSERT
WITH CHECK (auth.role() = 'service_role');

-- =====================================================
-- 4. FUNCTION TO AUTO-CREATE ADMIN ON SIGNUP
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_admin_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only create admin if user has admin role in metadata
  IF NEW.raw_user_meta_data->>'role' = 'admin' THEN
    INSERT INTO public.admins (id, email, name, avatar_url, role)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'avatar_url',
      COALESCE(NEW.raw_user_meta_data->>'role', 'admin')
    );
  END IF;
  RETURN NEW;
END;
$$;

-- =====================================================
-- 5. TRIGGER FOR AUTO-CREATING ADMIN
-- =====================================================
DROP TRIGGER IF EXISTS on_admin_created ON auth.users;
CREATE TRIGGER on_admin_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_admin_signup();

-- =====================================================
-- 6. FUNCTION TO HANDLE PASSWORD RESET
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_password_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update admin's updated_at timestamp when password is reset
  UPDATE public.admins
  SET updated_at = NOW()
  WHERE email = auth.email();
END;
$$;

-- =====================================================
-- 7. CREATE ADMIN SESSIONS TABLE (optional, for tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  is_valid BOOLEAN DEFAULT true
);

-- RLS for admin_sessions
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view own sessions"
ON admin_sessions FOR SELECT
USING (admin_id::text = auth.uid()::text);

CREATE POLICY "Admins can delete own sessions"
ON admin_sessions FOR DELETE
USING (admin_id::text = auth.uid()::text);

-- =====================================================
-- 8. CREATE ADMIN ACTIVITY LOG (optional)
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- RLS for activity log
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view activity log"
ON admin_activity_log FOR SELECT
USING (auth.jwt() ->> 'role' = 'admin');

-- =====================================================
-- 9. INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_id ON admin_activity_log(admin_id);

-- =====================================================
-- 10. SAMPLE ADMIN USER (optional - remove in production)
-- =====================================================
-- To create an admin manually, use Supabase Auth API or:
-- INSERT INTO admins (email, name, role) VALUES ('admin@outfyt.com', 'Admin', 'admin');

-- =====================================================
-- EMAIL TEMPLATE INSTRUCTIONS
-- =====================================================
-- Go to Authentication > Email Templates in Supabase Dashboard
--
-- Confirm Signup Template:
-- Subject: Welcome to Outfyt Admin Panel
-- Body:
-- <h2>Welcome to Outfyt!</h2>
-- <p>Click <a href="{{ .SiteURL }}/login?confirmed=true">here</a> to login to your admin panel.</p>
--
-- Reset Password Template:
-- Subject: Reset Your Outfyt Admin Password
-- Body:
-- <h2>Reset Password</h2>
-- <p>Click <a href="{{ .SiteURL }}/reset-password?token={{ .Token }}">here</a> to reset your password.</p>
-- <p>This link expires in 24 hours.</p>
--
-- Magic Link Template (if using):
-- Subject: Your Outfyt Admin Login Link
-- Body:
-- <h2>Login to Outfyt Admin</h2>
-- <p>Click <a href="{{ .SiteURL }}/auth/verify?token={{ .Token }}">here</a> to login.</p>

-- =====================================================
-- COMPLETE
-- =====================================================
SELECT 'Auth setup complete! Configure email templates in Supabase Dashboard.' AS status;
