'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, RefreshCcw } from 'lucide-react';

export function WhatsAppUnofficial() {
  const [status, setStatus] = useState<string>('unknown');
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp-web');
      const data = await res.json();
      setStatus(data.status);
      setQr(data.qr);
    } catch (err) {
      console.error('Failed to fetch whatsapp web status', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll every 3 seconds if not open
    const interval = setInterval(() => {
      if (status !== 'open') {
        fetchStatus();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [status]);

  const handleReset = async () => {
    setLoading(true);
    await fetch('/api/whatsapp-web', { method: 'POST' });
    await fetchStatus();
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    await fetch('/api/whatsapp-web', { method: 'DELETE' });
    setStatus('close');
    setQr(null);
    setLoading(false);
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-foreground">Unofficial WhatsApp Web (QR Scan)</CardTitle>
        <CardDescription className="text-muted-foreground">
          Link a regular WhatsApp number using a QR code scan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div>Status: <strong className="uppercase">{status}</strong></div>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <RefreshCcw className="size-4 mr-2" />}
            Reset / Reconnect
          </Button>
          <Button variant="destructive" size="sm" onClick={handleLogout} disabled={loading}>
            Logout
          </Button>
        </div>

        {status === 'qr' && qr && (
          <div className="mt-4 p-4 bg-white inline-block rounded-xl border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="WhatsApp QR Code" className="w-64 h-64" />
            <p className="text-sm text-center text-gray-800 mt-2 font-medium">Scan this QR Code with WhatsApp</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
