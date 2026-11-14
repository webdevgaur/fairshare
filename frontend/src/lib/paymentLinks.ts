/**
 * FairShare Payment Link Builders
 *
 * Builds deep links / payment URLs for Venmo, PayPal, and Cash App so users can
 * quickly request or send a settlement. Each builder encodes the recipient
 * handle and amount; if a required handle is missing, `buildPaymentLink`
 * returns null (callers should disable the action).
 */

export type PaymentProvider = 'venmo' | 'paypal' | 'cashapp'

export interface PaymentLinkParams {
  amount: number
  memo?: string
  /** Venmo username (from venmo_username handle) */
  username?: string | null
  /** PayPal handle / email (from paypal_handle handle) */
  paypal_handle?: string | null
  /** Cash App cashtag, including the leading `$` (from cashapp_cashtag handle) */
  cashtag?: string | null
}

const DEFAULT_MEMO = 'FairShare settlement'

export function buildVenmoLink({
  username,
  amount,
  memo,
}: {
  username: string
  amount: number
  memo?: string
}): string {
  return (
    `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(username)}` +
    `&amount=${amount.toFixed(2)}&note=${encodeURIComponent(memo ?? DEFAULT_MEMO)}`
  )
}

export function buildPayPalLink({ username, amount }: { username: string; amount: number }): string {
  return `https://paypal.me/${encodeURIComponent(username)}/${amount.toFixed(2)}`
}

export function buildCashAppLink({ cashtag, amount }: { cashtag: string; amount: number }): string {
  return `https://cash.app/${cashtag}/${amount.toFixed(2)}`
}

/**
 * Dispatch to the provider-specific builder. Returns null if the handle for the
 * requested provider is missing, so callers can disable the payment action.
 */
export function buildPaymentLink(
  provider: PaymentProvider,
  params: PaymentLinkParams,
): string | null {
  switch (provider) {
    case 'venmo':
      if (!params.username) return null
      return buildVenmoLink({ username: params.username, amount: params.amount, memo: params.memo })
    case 'paypal':
      if (!params.paypal_handle) return null
      return buildPayPalLink({ username: params.paypal_handle, amount: params.amount })
    case 'cashapp':
      if (!params.cashtag) return null
      return buildCashAppLink({ cashtag: params.cashtag, amount: params.amount })
    default:
      return null
  }
}
