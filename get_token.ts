import { createClient } from '@supabase/supabase-js';
import { decrypt } from './src/lib/whatsapp/encryption';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data, error } = await supabase.from('whatsapp_config').select('*');
  if (error) console.error(error);
  data?.forEach(config => {
    console.log('Phone:', config.phone_number_id);
    console.log('Token:', decrypt(config.access_token));
    console.log('---');
  });
}
main();
