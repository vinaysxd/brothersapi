import { createClient } from '@supabase/supabase-js';

const suapbaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY_ROLE;

export const suapbase = createClient(suapbaseUrl, supabaseServiceKey)

