# How the Snuggly Duckling ERP works

The interactive version is the **System Map** artifact; this file is the same facts in text.

## The three rules everything follows
1. **One inventory ledger.** Every stock movement is a row in `inventory_txns`. On hand = the sum of those rows. A trigger updates `stock` and the weighted average cost, and refuses anything that would go negative.
2. **One journal.** The same database function writes the books (`journal_lines`), so stock and money can't disagree.
3. **Live.** Every screen listens for changes (Supabase Realtime) and refreshes within about a second.

---

## Sell

### Point of Sale
- **Does:** scan or search items, discounts, tax, cash change, printed receipt.
- **Lives:** POS page → `post_sale` → `sales`, `sale_lines`, `inventory_txns`, `journal_lines`.
- **Affects:** on hand at that store; Dr Cash / Dr Discounts / Cr Revenue / Cr Tax Payable; Dr COGS / Cr Inventory at average cost; shop availability; MRP on hand. Gift boxes use packed boxes first, then backflush their components.
- **If Wright asks** "where does COGS come from?": qty × the item's average cost at that moment.

### Sales orders and the customer shop
- **Does:** a customer (shop) or staff member places a pickup order. Placed → Fulfilled → Closed, or Cancelled.
- **Lives:** Sales Orders and Customer Shop → `create_sales_order`, `fulfill_sales_order` (runs `post_sale`), `close_`, `cancel_sales_order`.
- **Affects:** a placed order changes no stock or money. It claims stock in pickup-date order (backorders, with an estimated date) and is a gross requirement in MRP. Fulfilling it posts the sale.
- **If Wright asks** "how is the estimated available date calculated?": the earliest open PO's expected date, else today + lead time.

## Stock

### Inventory, transfers and counts
- **Lives:** Inventory, and Transfers & Counts → `transfer_stock`, `adjust_stock`.
- **Affects:** a transfer moves stock at average cost with no journal entry (the company owns the same goods). A count posts the difference to Inventory Shrink with a reason code.
- **If Wright asks** "why no journal entry on a transfer?": total inventory value doesn't change.

### Barcodes
- UPC labels (Barcode Labels page, PDF download). Scanning works by USB scanner, the phone camera, or typing, in POS, receiving, counts and the customer shop.

## Buy

### Purchase orders
- **Does:** Draft → Sent → (Partly) Received → Closed. Expected date = date sent + the supplier's quoted lead time, locked in when sent. Each receipt is compared with it.
- **Lives:** Purchase Orders → `create_purchase_order`, `send_purchase_order`, `receive_purchase_order`, `close_`, `cancel_purchase_order`, `pay_supplier_bill`.
- **Affects:**
  - Sending: "On order", backorder dates, and MRP scheduled receipts.
  - Receiving: stock goes up at the PO price, average cost recalculates, Dr Inventory / Cr Accounts Payable, and a supplier bill is created (due = receipt date + terms).
  - Paying: Dr AP / Cr Cash.
- **Scan to receive:** each scan of a label adds 1 to that line. A label that isn't on the PO is refused.
- **If Wright asks** "what happens if they short-ship?": the PO stays Partly received. Close short, and the fill rate shows it.

### Supplier scorecard (Suppliers page)
- All computed from PO history in `v_supplier_scorecard`:
  - **On time:** first receipt on or before the expected date.
  - **Actual lead time:** first receipt − date sent.
  - **Fill rate:** received ÷ ordered, on finished POs.
  - **Owed:** unpaid bills and their due dates.
- **Rating:** Keep = ≥ 90% on time and ≥ 95% fill · Replace = < 70% on time or < 90% fill · Watch = in between.

### Replenishment
- Computed in `v_replenishment` from daily usage (sales + units used in sold boxes + production issues) over the Settings window, counting zero days:
  - **ROP** = d̄ × L + z × σ × √L
  - **EOQ** = √(2DS ÷ H), with D = d̄ × 365 and H = holding rate × average cost
  - **Periodic review:** order up to d̄(R + L) + zσ√(R + L), minus on hand + on order
  - **Order-by:** today if at or below ROP, else the day usage brings it down to ROP
- **Affects:** "Create PO" opens a PO prefilled for each supplier. Settings changes (S, H, z, R) recalculate it immediately.
- **If Wright asks** "why is the cola EOQ so big?": it's cheap to hold ($0.43 × 25%), so bigger, less frequent orders cost less overall.

## Make

### Production (work orders)
- **Does:** Planned → In progress → Completed, or Cancelled while still planned. Any item with a bill of materials (made items and gift boxes), any location.
- **Lives:** Production → `create_production_order`, `start_production_order`, `complete_production_order`, `cancel_production_order`.
- **Affects:**
  - **Start:** issues each component (qty started × qty per unit) out of that location. Dr Work in Process / Cr Inventory.
  - **Complete:** good units go on the shelf at material ÷ units started. The scrapped units' cost goes to Production Scrap. Dr Inventory + Dr Production Scrap / Cr Work in Process.
  - **MRP:** a planned work order is a scheduled receipt for the item, and its components are gross requirements.
- **Rules:** good + scrapped must equal units started (reworked units are inside good). Scrap or rework needs a quality reason code. Staff enter the actual start and finish times: up to 7 days back, never in the future, finish after start.
- **Report** (Production → Production report, by finish date):
  - **Yield** = good ÷ started
  - **First-pass yield** = (good − reworked) ÷ started
  - **Scrap rate** = scrapped ÷ started, plus scrap cost
  - **Cycle time** = start to finish
  - **On-time completion** = finished by the due date
  - Also broken down by item and by reason code.
- **If Wright asks** "how is the finished cost rolled up?": the components actually issued at their average cost, divided by units started. Scrap doesn't inflate the good units' cost; it's written off separately.

## Plan

### MRP
- **Lives:** MRP page; `src/modules/mrp/engine.ts` uses the Chapter 10 record formulas (`npm run test:mrp` checks it against the slide problems).
- **Does:** open sales orders → gross requirements by week → net against on hand and scheduled receipts → lot size (L4L or FOQ) → release offset by lead time → each parent's releases become its components' gross requirements, level by level.
- **Affects:** "Release" turns a planned order into a sent PO or a planned work order, which then shows as a scheduled receipt. Edit LT / Q changes the item, and the plan recalculates.
