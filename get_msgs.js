require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('messages').select('conversation_id, sender_type, content_text').order('created_at', { ascending: false }).limit(10).then(res => console.dir(res.data, {depth: null}));
