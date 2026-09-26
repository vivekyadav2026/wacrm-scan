import { NextResponse } from 'next/server';
import { initWhatsAppLocal } from '@/lib/whatsapp-baileys';

export async function GET() {
  // Ensure it's initializing if not already
  if (global.waConnectionState === 'close' || !global.waSocket) {
    initWhatsAppLocal().catch(console.error);
  }

  return NextResponse.json({
    status: global.waConnectionState,
    qr: global.waQrCodeDataUrl || null,
  });
}

export async function POST() {
  // Allow manual reconnect/reset
  global.waSocket?.ws?.close();
  global.waSocket = null;
  global.waConnectionState = 'close';
  global.waQrCodeDataUrl = null;
  
  await initWhatsAppLocal();

  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
      if (profile?.account_id) {
        // Check if config exists
        const { data: existing } = await supabase.from('whatsapp_config').select('id').eq('account_id', profile.account_id).maybeSingle();
        if (!existing) {
          // Create a dummy config for Unofficial API to work
          const { encrypt } = await import('@/lib/whatsapp/encryption');
          await supabase.from('whatsapp_config').insert({
            account_id: profile.account_id,
            user_id: user.id,
            phone_number_id: '1234567890', // Dummy phone number ID
            access_token: encrypt('unofficial-token'),
            verify_token: encrypt('unofficial-verify'),
          });
          console.log('Created dummy WhatsApp config for Unofficial API.');
        }
      }
    }
  } catch (err) {
    console.error('Error creating dummy config:', err);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  try {
    if (global.waSocket) {
      await global.waSocket.logout();
      global.waSocket = null;
    }
  } catch (err) {
    console.error('Error logging out socket:', err);
  }

  global.waConnectionState = 'close';
  global.waQrCodeDataUrl = null;

  try {
    const fs = require('fs');
    const path = require('path');
    const authFolder = path.join(process.cwd(), 'wa-auth');
    if (fs.existsSync(authFolder)) {
      fs.rmSync(authFolder, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Error deleting wa-auth folder:', err);
  }

  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
      if (profile?.account_id) {
        // Delete the dummy config
        await supabase.from('whatsapp_config').delete().eq('account_id', profile.account_id).eq('phone_number_id', '1234567890');
      }
    }
  } catch (err) {
    console.error('Error deleting dummy config:', err);
  }

  return NextResponse.json({ success: true });
}
