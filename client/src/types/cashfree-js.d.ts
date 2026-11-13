// @cashfreepayments/cashfree-js ships without TypeScript types. This describes the two things we use from it.
declare module "@cashfreepayments/cashfree-js" {
  export interface CashfreeCheckoutOptions {
    // From our server (POST /payments/orders).
    paymentSessionId: string;
    // "_self" opens Cashfree's payment page in this tab (best on phones) and sends the person back to our return page.
    redirectTarget?: "_self" | "_blank" | "_top" | "_modal";
  }

  export interface Cashfree {
    checkout(options: CashfreeCheckoutOptions): Promise<unknown>;
  }

  export function load(options: { mode: "sandbox" | "production" }): Promise<Cashfree | null>;
}
