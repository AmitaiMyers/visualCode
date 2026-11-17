// Built-in demo for "Try the demo": a small checkout service and one pull request's worth of changes.
// Generated with a real diff tool so the diff's line numbers match the new file contents exactly.
import type { SourceFile } from "../model/types";

export const DEMO_TITLE = "acme/checkout #128: Coupon codes";
export const DEMO_ID = "demo:acme-checkout-128";

export const DEMO_FILES: SourceFile[] = [
  {
    "path": "scripts/daily_report.py",
    "content": "import json\nfrom pathlib import Path\n\nREPORT_PATH = Path(\"orders.json\")\n\n\ndef load_orders(path):\n    return json.loads(path.read_text())\n\n\ndef revenue(orders):\n    return sum(order[\"total\"] for order in orders)\n\n\ndef summarize(orders):\n    return f\"{len(orders)} orders, revenue {revenue(orders):.2f}\"\n\n\nif __name__ == \"__main__\":\n    print(summarize(load_orders(REPORT_PATH)))\n"
  },
  {
    "path": "src/checkout/cart.ts",
    "content": "import { applyDiscount, taxFor } from \"./pricing\";\n\nexport interface LineItem {\n  sku: string;\n  unitPrice: number;\n  quantity: number;\n}\n\nexport class Cart {\n  private readonly items: LineItem[] = [];\n\n  add(item: LineItem): void {\n    if (item.quantity <= 0) {\n      throw new Error(`Quantity must be positive for ${item.sku}`);\n    }\n    this.items.push(item);\n  }\n\n  subtotal(): number {\n    return this.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);\n  }\n\n  total(coupon: string | null): number {\n    const discounted = applyDiscount(this.subtotal(), coupon);\n    return roundCents(discounted + taxFor(discounted));\n  }\n}\n\nfunction roundCents(amount: number): number {\n  return Math.round(amount * 100) / 100;\n}\n"
  },
  {
    "path": "src/checkout/coupons.ts",
    "content": "export interface Coupon {\n  code: string;\n  amountOff(subtotal: number): number;\n}\n\nconst COUPONS: Coupon[] = [\n  { code: \"WELCOME10\", amountOff: (subtotal) => subtotal * 0.1 },\n  { code: \"FIVEOFF\", amountOff: () => 5 },\n];\n\nexport function findCoupon(code: string): Coupon {\n  const coupon = COUPONS.find((candidate) => candidate.code === code);\n  if (coupon === undefined) {\n    throw new Error(`Unknown coupon: ${code}`);\n  }\n  return coupon;\n}\n"
  },
  {
    "path": "src/checkout/index.ts",
    "content": "import { Cart } from \"./cart\";\nimport { chargeCard } from \"./payment\";\nimport { formatMoney } from \"../util/format\";\n\n/** Entry point: turns a cart into a paid order. */\nexport async function runCheckout(cart: Cart, cardToken: string, coupon: string | null): Promise<string> {\n  const total = cart.total(coupon);\n  const receipt = await chargeCard(cardToken, total);\n  return `Paid ${formatMoney(total)} (receipt ${receipt})`;\n}\n"
  },
  {
    "path": "src/checkout/payment.ts",
    "content": "import { formatMoney } from \"../util/format\";\n\nexport async function chargeCard(cardToken: string, amount: number): Promise<string> {\n  validateToken(cardToken);\n  console.info(`Charging ${formatMoney(amount)}`);\n  return `rcpt_${cardToken.slice(-4)}_${Date.now()}`;\n}\n\nfunction validateToken(cardToken: string): void {\n  if (!cardToken.startsWith(\"tok_\")) {\n    throw new Error(\"Card token must start with tok_\");\n  }\n}\n"
  },
  {
    "path": "src/checkout/pricing.ts",
    "content": "import { findCoupon } from \"./coupons\";\n\nconst TAX_RATE = 0.17;\n\nexport function applyDiscount(subtotal: number, code: string | null): number {\n  if (code === null) {\n    return subtotal;\n  }\n  const coupon = findCoupon(code);\n  return Math.max(0, subtotal - coupon.amountOff(subtotal));\n}\n\nexport function taxFor(amount: number): number {\n  return amount * TAX_RATE;\n}\n"
  },
  {
    "path": "src/util/format.ts",
    "content": "export function formatMoney(amount: number): string {\n  return `$${amount.toFixed(2)}`;\n}\n"
  }
];

export const DEMO_DIFF = "diff --git a/src/checkout/cart.ts b/src/checkout/cart.ts\n--- a/src/checkout/cart.ts\n+++ b/src/checkout/cart.ts\n@@ -10,6 +10,9 @@\n   private readonly items: LineItem[] = [];\n \n   add(item: LineItem): void {\n+    if (item.quantity <= 0) {\n+      throw new Error(`Quantity must be positive for ${item.sku}`);\n+    }\n     this.items.push(item);\n   }\n \n@@ -19,6 +22,10 @@\n \n   total(coupon: string | null): number {\n     const discounted = applyDiscount(this.subtotal(), coupon);\n-    return discounted + taxFor(discounted);\n+    return roundCents(discounted + taxFor(discounted));\n   }\n }\n+\n+function roundCents(amount: number): number {\n+  return Math.round(amount * 100) / 100;\n+}\ndiff --git a/src/checkout/coupons.ts b/src/checkout/coupons.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/checkout/coupons.ts\n@@ -0,0 +1,17 @@\n+export interface Coupon {\n+  code: string;\n+  amountOff(subtotal: number): number;\n+}\n+\n+const COUPONS: Coupon[] = [\n+  { code: \"WELCOME10\", amountOff: (subtotal) => subtotal * 0.1 },\n+  { code: \"FIVEOFF\", amountOff: () => 5 },\n+];\n+\n+export function findCoupon(code: string): Coupon {\n+  const coupon = COUPONS.find((candidate) => candidate.code === code);\n+  if (coupon === undefined) {\n+    throw new Error(`Unknown coupon: ${code}`);\n+  }\n+  return coupon;\n+}\ndiff --git a/src/checkout/payment.ts b/src/checkout/payment.ts\n--- a/src/checkout/payment.ts\n+++ b/src/checkout/payment.ts\n@@ -2,7 +2,7 @@\n \n export async function chargeCard(cardToken: string, amount: number): Promise<string> {\n   validateToken(cardToken);\n-  logCharge(amount);\n+  console.info(`Charging ${formatMoney(amount)}`);\n   return `rcpt_${cardToken.slice(-4)}_${Date.now()}`;\n }\n \n@@ -11,7 +11,3 @@\n     throw new Error(\"Card token must start with tok_\");\n   }\n }\n-\n-function logCharge(amount: number): void {\n-  console.info(`Charging ${formatMoney(amount)}`);\n-}\ndiff --git a/src/checkout/pricing.ts b/src/checkout/pricing.ts\n--- a/src/checkout/pricing.ts\n+++ b/src/checkout/pricing.ts\n@@ -1,10 +1,13 @@\n+import { findCoupon } from \"./coupons\";\n+\n const TAX_RATE = 0.17;\n \n-export function applyDiscount(subtotal: number, coupon: string | null): number {\n-  if (coupon === \"WELCOME10\") {\n-    return subtotal * 0.9;\n+export function applyDiscount(subtotal: number, code: string | null): number {\n+  if (code === null) {\n+    return subtotal;\n   }\n-  return subtotal;\n+  const coupon = findCoupon(code);\n+  return Math.max(0, subtotal - coupon.amountOff(subtotal));\n }\n \n export function taxFor(amount: number): number {\n";
