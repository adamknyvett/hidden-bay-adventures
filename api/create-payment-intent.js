import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing in NZD cents (special prices)
const PRICES = {
  'Tui Ridge Studio':   139,
  'Kahawai Quarters':   149,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cabin, checkIn, checkOut, guests, name, email } = req.body;

  if (!cabin || !checkIn || !checkOut || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const nightlyRate = PRICES[cabin];
  if (!nightlyRate) return res.status(400).json({ error: 'Invalid cabin selection' });

  // Calculate nights
  const inDate  = new Date(checkIn);
  const outDate = new Date(checkOut);
  const nights  = Math.round((outDate - inDate) / (1000 * 60 * 60 * 24));

  if (nights < 1) return res.status(400).json({ error: 'Invalid dates' });

  const totalNZD   = nightlyRate * nights;
  const totalCents = totalNZD * 100;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   totalCents,
      currency: 'nzd',
      metadata: {
        cabin,
        checkIn,
        checkOut,
        nights: nights.toString(),
        guests: (guests || '').toString(),
        guestName:  name,
        guestEmail: email,
      },
      receipt_email: email,
      description: `Hidden Bay Adventures — ${cabin} · ${nights} night${nights > 1 ? 's' : ''} · ${checkIn} to ${checkOut}`,
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      amount:       totalNZD,
      nights,
      cabin,
    });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: 'Payment setup failed' });
  }
}
