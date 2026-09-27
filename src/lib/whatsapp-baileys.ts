import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import QRCode from 'qrcode';
import pino from 'pino';

// Define the global type so TypeScript doesn't complain
declare global {
  var waSocket: WASocket | null;
  var waQrCodeDataUrl: string | null;
  var waConnectionState: 'connecting' | 'open' | 'close' | 'qr';
}

if (!global.waConnectionState) {
  global.waConnectionState = 'close';
}

export async function initWhatsAppLocal() {
  if (global.waSocket) {
    return global.waSocket;
  }

  global.waConnectionState = 'connecting';

  const authStateDir = path.join(process.cwd(), 'wa-auth');
  const { state, saveCreds } = await useMultiFileAuthState(authStateDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }), // Suppress detailed logs
  });

  global.waSocket = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('QR Code generated. Scan to login.');
      global.waConnectionState = 'qr';
      try {
        global.waQrCodeDataUrl = await QRCode.toDataURL(qr);
      } catch (err) {
        console.error('Failed to generate QR data URL', err);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
      
      global.waSocket = null;
      global.waConnectionState = 'close';
      global.waQrCodeDataUrl = null;

      if (shouldReconnect) {
        initWhatsAppLocal();
      }
    } else if (connection === 'open') {
      console.log('Opened connection to WhatsApp!');
      global.waConnectionState = 'open';
      global.waQrCodeDataUrl = null;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return; // Ignore system messages

      const remoteJid = msg.key.remoteJid;
      if (remoteJid?.includes('@g.us')) return; // Ignore groups for now
      if (remoteJid?.includes('status@broadcast')) return;

      console.log('--- RAW BAILEYS MESSAGE INTERCEPTED ---');
      console.log(JSON.stringify({ key: msg.key, pushName: msg.pushName, participant: msg.participant }, null, 2));
      
      const customerNumber = remoteJid?.split('@')[0].split(':')[0];
      if (!customerNumber) return;

      const isFromMe = msg.key.fromMe;
      const messageId = msg.key.id;
      const timestamp = msg.messageTimestamp?.toString();
      
      let messageType = 'text';
      let messageText = '';
      
      if (msg.message.conversation) {
        messageText = msg.message.conversation;
      } else if (msg.message.extendedTextMessage?.text) {
        messageText = msg.message.extendedTextMessage.text;
      } else {
        console.log('Skipping non-text message type');
        return;
      }

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      
      const { data: configs } = await supabase.from('whatsapp_config').select('phone_number_id, account_id').limit(1);
      if (!configs || configs.length === 0) return;
      const phoneNumberId = configs[0].phone_number_id;
      const accountId = configs[0].account_id;

      if (isFromMe) {
        // Find the conversation for this customer
        const { data: contact } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone', customerNumber)
          .eq('account_id', accountId)
          .maybeSingle();

        if (contact) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('id')
            .eq('contact_id', contact.id)
            .eq('account_id', accountId)
            .maybeSingle();

          if (conv) {
            // Insert outgoing message directly to sync with CRM
            await supabase.from('messages').insert({
              conversation_id: conv.id,
              sender_type: 'agent',
              content_type: 'text',
              content_text: messageText,
              message_id: messageId,
              status: 'delivered'
            });
            await supabase.from('conversations').update({
              last_message_text: messageText,
              last_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }).eq('id', conv.id);
            console.log('Synced outgoing message from phone to CRM');
          }
        }
        return;
      }

      // Incoming message from customer - Forward to local webhook
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: phoneNumberId,
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "Unofficial API",
                    phone_number_id: phoneNumberId
                  },
                  contacts: [
                    {
                      profile: {
                        name: msg.pushName || customerNumber
                      },
                      wa_id: customerNumber
                    }
                  ],
                  messages: [
                    {
                      from: customerNumber,
                      id: messageId,
                      timestamp: timestamp,
                      type: messageType,
                      text: {
                        body: messageText
                      }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };

      const rawBody = JSON.stringify(payload);
      const crypto = await import('node:crypto');
      const secret = process.env.META_APP_SECRET?.split(',')[0].trim();
      
      if (!secret) return;
      const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      const res = await fetch('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature
        },
        body: rawBody
      });
      if (res.ok) console.log('Successfully forwarded message from', customerNumber);
    } catch (err) {
      console.error('Error forwarding message from Baileys:', err);
    }
  });

  // Handle message receipts (delivered/read)
  sock.ev.on('messages.update', async (updates) => {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      
      for (const update of updates) {
        if (update.update.status) {
          let status = '';
          if (update.update.status === 3) status = 'delivered';
          else if (update.update.status === 4) status = 'read';
          
          if (status && update.key.id) {
            // Update the CRM directly for simplicity
            await supabase
              .from('messages')
              .update({ status })
              .eq('message_id', update.key.id);
            console.log(`Updated message ${update.key.id} status to ${status}`);
          }
        }
      }
    } catch (err) {
      console.error('Error updating message status from Baileys:', err);
    }
  });

  return sock;
}
