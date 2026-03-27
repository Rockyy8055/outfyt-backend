/**
 * Payment Service for Outfyt
 * Handles Razorpay payment integration
 */

import Razorpay from 'razorpay';
import crypto from 'crypto';

// Initialize Razorpay with test credentials
export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_SVS9yEFnBQEGdS',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'tsIaMuPj30gumys7WNiGz6cr',
});

export interface CreateOrderResponse {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  breakdown: {
    productAmount: number;
    deliveryFee: number;
    platformFee: number;
    packingCharge: number;
    gstAmount: number;
    totalAmount: number;
  };
}

export interface VerifyPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Create Razorpay order
 */
export async function createRazorpayOrder(
  amount: number,
  breakdown: {
    productAmount: number;
    deliveryFee: number;
    platformFee: number;
    packingCharge: number;
    gstAmount: number;
    totalAmount: number;
  },
  receipt: string
): Promise<CreateOrderResponse> {
  const amountPaise = Math.round(amount * 100); // Convert to paise

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: receipt,
    notes: {
      productAmount: breakdown.productAmount.toString(),
      deliveryFee: breakdown.deliveryFee.toString(),
      platformFee: breakdown.platformFee.toString(),
      packingCharge: breakdown.packingCharge.toString(),
      gstAmount: breakdown.gstAmount.toString(),
    },
  });

  return {
    razorpayOrderId: order.id,
    amount: amount,
    currency: 'INR',
    breakdown,
  };
}

/**
 * Verify Razorpay payment signature
 */
export function verifyPaymentSignature(input: VerifyPaymentInput): boolean {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;
  
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'tsIaMuPj30gumys7WNiGz6cr')
    .update(body)
    .digest('hex');

  return expectedSignature === razorpaySignature;
}

/**
 * Fetch payment details from Razorpay
 */
export async function fetchPaymentDetails(paymentId: string) {
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    console.error('Failed to fetch payment details:', error);
    return null;
  }
}

export default {
  razorpay,
  createRazorpayOrder,
  verifyPaymentSignature,
  fetchPaymentDetails,
};
