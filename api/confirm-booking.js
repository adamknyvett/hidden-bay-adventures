import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paymentIntentId } = req.body;

  if (!paymentIntentId) return res.status(400).json({ error: 'Missing payment intent ID' });

  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed', status: intent.status });
    }

    const { cabin, checkIn, checkOut, nights, guests, guestName, guestEmail } = intent.metadata;
    const amountNZD = (intent.amount / 100).toFixed(2);

    // Build confirmation email body (sent via mailto fallback — 
    // swap in SendGrid/Resend API key via env var for full automation)
    const confirmation = {
      cabin,
      checkIn,
      checkOut,
      nights,
      guests,
      guestName,
      guestEmail,
      amountNZD,
      paymentId: intent.id,
    };

    // If RESEND_API_KEY is set, send emails automatically
    if (process.env.RESEND_API_KEY) {
      await sendConfirmationEmails(confirmation);
    }

    res.status(200).json({ success: true, booking: confirmation });

  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Confirmation failed' });
  }
}

async function sendConfirmationEmails({ cabin, checkIn, checkOut, nights, guests, guestName, guestEmail, amountNZD, paymentId }) {
  const headers = {
    'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const guestBody = `
Hi ${guestName},

Your booking at Hidden Bay Adventures is confirmed!

Cabin:    ${cabin}
Check-in: ${checkIn}
Check-out:${checkOut}
Nights:   ${nights}
Guests:   ${guests}
Total:    $${amountNZD} NZD
Reference:${paymentId}

We'll be in touch shortly with check-in details.

Questions? bookings@hiddenbayadventures.co.nz

See you soon,
Hidden Bay Adventures
Waihi Beach, Bay of Plenty
  `.trim();

  const ownerBody = `
New booking received!

Guest:    ${guestName} (${guestEmail})
Cabin:    ${cabin}
Check-in: ${checkIn}
Check-out:${checkOut}
Nights:   ${nights}
Guests:   ${guests}
Paid:     $${amountNZD} NZD
Stripe ID:${paymentId}
  `.trim();

  // Email to guest
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: 'bookings@hiddenbayadventures.co.nz',
      to:   guestEmail,
      subject: `Booking Confirmed — ${cabin} · ${checkIn}`,
      text: guestBody,
    }),
  });

  // Email to owner
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: 'bookings@hiddenbayadventures.co.nz',
      to:   'bookings@hiddenbayadventures.co.nz',
      subject: `New Booking — ${cabin} · ${checkIn} · $${amountNZD}`,
      text: ownerBody,
    }),
  });
}
