import '../env.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY_ROLE;
console.log('SUPABASE_URL:', supabaseUrl);
console.log('SERVICE_KEY loaded:', !!supabaseServiceKey); // prints true/false without exposing the key

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

