require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const GCM_IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  if (parts.length === 3) {
    const [ivHex, ctHex, tagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  return null;
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

supabase.from('whatsapp_config').select('*').then(({ data }) => {
  data.forEach(c => {
    console.log('Phone:', c.phone_number_id);
    console.log('Token:', decrypt(c.access_token));
  });
});
