import '../env.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY_ROLE;
console.log('SUPABASE_URL:', supabaseUrl);
console.log('SERVICE_KEY loaded:', !!supabaseServiceKey);
console.log('SERVICE_KEY prefix:', supabaseServiceKey?.substring(0, 20));

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

// Database queries only.
export const supabase = createClient(supabaseUrl, supabaseServiceKey, clientOptions);

// Auth operations (e.g. getUser). Kept separate so auth session state
// can't leak into the client used for database queries.
export const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, clientOptions);
