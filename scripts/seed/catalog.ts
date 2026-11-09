// The Snuggly Duckling's master data: locations, suppliers, items, BOMs and
// customers. Demand and supplier-behavior knobs live next to each record so the
// simulation in simulate.ts reads like the business it models.

export type Season = 'drink' | 'candy' | 'salty' | 'popcorn' | 'gift' | 'trail' | 'flat'

export const LOCATIONS = [
  { code: 'MAIN', name: 'Main Street Store', kind: 'store', address: '214 N University Ave, Provo, UT' },
  { code: 'RIVR', name: 'Riverside Store', kind: 'store', address: '1180 S State St, Orem, UT' },
  { code: 'WHSE', name: 'Warehouse & Kitchen', kind: 'warehouse', address: '455 W 1720 N, Provo, UT' },
  { code: 'HOLD', name: 'Returns Hold', kind: 'hold', address: 'Quarantine shelf, Warehouse & Kitchen' },
] as const
export const MAIN = 1, RIVR = 2, WHSE = 3, HOLD = 4
export const STORES = [MAIN, RIVR]

export type Supplier = {
  name: string; contact: string; email: string; phone: string; address: string
  lead: number; terms: string; termsDays: number; discPct: number; discDays: number
  // simulated behavior (never stored; the scorecard has to rediscover it from PO history)
  onTime: number; lateMax: number; early: number; shortP: number; splitP: number; coverDays: number
}

export const SUPPLIERS: Supplier[] = [
  { name: 'Bonneville Nut & Fruit', contact: 'Karen Ostler', email: 'orders@bonnevillenut.example', phone: '(801) 555-0141',
    address: '2290 S 900 W, Salt Lake City, UT', lead: 7, terms: 'Net 30', termsDays: 30, discPct: 0, discDays: 0,
    onTime: 0.9, lateMax: 3, early: 0.06, shortP: 0.03, splitP: 0, coverDays: 21 },
  { name: 'Sweet Summit Candy Distributing', contact: 'Devin Archuleta', email: 'sales@sweetsummit.example', phone: '(801) 555-0178',
    address: '77 E Center St, Lehi, UT', lead: 5, terms: '2/10 Net 30', termsDays: 30, discPct: 2, discDays: 10,
    onTime: 0.85, lateMax: 4, early: 0.03, shortP: 0.05, splitP: 0, coverDays: 14 },
  { name: 'Wasatch Beverage Co.', contact: 'Marisol Vega', email: 'dispatch@wasatchbev.example', phone: '(385) 555-0119',
    address: '1600 N Geneva Rd, Orem, UT', lead: 3, terms: 'Net 15', termsDays: 15, discPct: 0, discDays: 0,
    onTime: 0.97, lateMax: 1, early: 0.02, shortP: 0.02, splitP: 0, coverDays: 10 },
  { name: 'Kraft & Crate Packaging', contact: 'Owen Pratt', email: 'cs@kraftandcrate.example', phone: '(208) 555-0163',
    address: '410 Industrial Way, Pocatello, ID', lead: 14, terms: 'Net 45', termsDays: 45, discPct: 0, discDays: 0,
    onTime: 0.38, lateMax: 8, early: 0, shortP: 0.08, splitP: 0, coverDays: 35 },
  { name: 'Valley Foodservice Supply', contact: 'Jared Nielsen', email: 'orders@valleyfoodservice.example', phone: '(801) 555-0102',
    address: '930 S Mountain Vista Pkwy, Provo, UT', lead: 4, terms: 'Net 30', termsDays: 30, discPct: 0, discDays: 0,
    onTime: 0.82, lateMax: 3, early: 0.04, shortP: 0.4, splitP: 0.15, coverDays: 14 },
  { name: 'Timp Trail Snacks', contact: 'Brooke Halverson', email: 'wholesale@timptrail.example', phone: '(801) 555-0187',
    address: '55 N 300 W, American Fork, UT', lead: 6, terms: 'Net 30', termsDays: 30, discPct: 0, discDays: 0,
    onTime: 0.72, lateMax: 5, early: 0.02, shortP: 0.09, splitP: 0.3, coverDays: 14 },
]

export type Item = {
  sku: string; name: string; category: string
  kind: 'resale' | 'component' | 'made' | 'kit'
  uom: 'ea' | 'lb'
  price: number; cost: number; sup: number | null   // 1-based supplier id
  base: number          // Main Street units per open day (0 = not sold directly)
  season: Season
  pack: number          // purchase case size
  mpu: number           // minutes of labor per unit (made/kit)
  lead?: number         // production lead time in days (made/kit)
  rivr?: number         // Riverside demand relative to Main (default 0.7)
}

const R = (sku: string, name: string, category: string, price: number, cost: number, sup: number, base: number,
           season: Season, pack: number, rivr?: number): Item =>
  ({ sku, name, category, kind: 'resale', uom: 'ea', price, cost, sup, base, season, pack, mpu: 0, rivr })
const C = (sku: string, name: string, category: string, uom: 'ea' | 'lb', cost: number, sup: number, pack: number): Item =>
  ({ sku, name, category, kind: 'component', uom, price: 0, cost, sup, base: 0, season: 'flat', pack, mpu: 0 })

export const ITEMS: Item[] = [
  R('SD-1001', 'Kettle Chips — Sea Salt 5 oz', 'Chips & Salty', 3.49, 1.45, 6, 7, 'salty', 24),
  R('SD-1002', 'Kettle Chips — BBQ 5 oz', 'Chips & Salty', 3.49, 1.45, 6, 5, 'salty', 24),
  R('SD-1003', 'Pretzel Twists 8 oz', 'Chips & Salty', 2.79, 1.10, 6, 4, 'salty', 24),
  R('SD-1004', 'Beef Jerky — Original 3 oz', 'Jerky & Bars', 7.99, 3.40, 6, 3, 'salty', 12),
  R('SD-1005', 'Granola Bar — Oats & Honey', 'Jerky & Bars', 1.49, 0.55, 6, 6, 'trail', 48),
  R('SD-1101', 'Cola 12 oz Can', 'Beverages', 1.29, 0.42, 3, 10, 'drink', 24, 0.8),
  R('SD-1102', 'Lemon-Lime Soda 12 oz Can', 'Beverages', 1.29, 0.42, 3, 6, 'drink', 24, 0.8),
  R('SD-1103', 'Root Beer 12 oz Can', 'Beverages', 1.29, 0.45, 3, 5, 'drink', 24, 0.8),
  R('SD-1104', 'Sparkling Water — Grapefruit', 'Beverages', 1.49, 0.50, 3, 7, 'drink', 24, 0.85),
  R('SD-1105', 'Energy Drink 16 oz', 'Beverages', 3.29, 1.35, 3, 5, 'drink', 24, 0.6),
  R('SD-1201', 'Gummy Bears 5 oz', 'Candy', 2.99, 1.10, 2, 4, 'candy', 24),
  R('SD-1202', 'Milk Chocolate Bar', 'Candy', 1.99, 0.80, 2, 6, 'candy', 36),
  R('SD-1203', 'Sour Worms 5 oz', 'Candy', 2.99, 1.15, 2, 4, 'candy', 24),
  R('SD-1204', 'Peanut Butter Cups 2-pack', 'Candy', 1.79, 0.70, 2, 5, 'candy', 36),
  R('SD-1205', 'Licorice Twists 7 oz', 'Candy', 3.29, 1.25, 2, 2.5, 'candy', 24),

  C('SD-2001', 'Almonds, raw', 'Ingredients', 'lb', 4.20, 1, 25),
  C('SD-2002', 'Peanuts, roasted', 'Ingredients', 'lb', 2.10, 1, 25),
  C('SD-2003', 'Cashews, whole', 'Ingredients', 'lb', 6.50, 1, 25),
  C('SD-2004', 'Raisins', 'Ingredients', 'lb', 2.40, 1, 25),
  C('SD-2005', 'Candy-Coated Chocolates', 'Ingredients', 'lb', 3.80, 2, 10),
  C('SD-2006', 'Popcorn Kernels', 'Ingredients', 'lb', 0.90, 5, 50),
  C('SD-2007', 'Butter', 'Ingredients', 'lb', 3.60, 5, 36),
  C('SD-2008', 'Brown Sugar', 'Ingredients', 'lb', 0.95, 5, 50),
  C('SD-2009', 'Cheddar Seasoning', 'Ingredients', 'lb', 5.20, 5, 10),
  C('SD-2010', 'Coconut Oil', 'Ingredients', 'lb', 2.80, 5, 35),
  C('SD-2101', 'Kraft Stand-Up Bag 12 oz', 'Packaging', 'ea', 0.22, 4, 500),
  C('SD-2102', 'Popcorn Bag 8 oz', 'Packaging', 'ea', 0.15, 4, 500),
  C('SD-2103', 'Gift Box', 'Packaging', 'ea', 0.95, 4, 100),
  C('SD-2104', 'Snuggly Duckling Label', 'Packaging', 'ea', 0.05, 4, 1000),

  { sku: 'SD-3001', name: 'House Trail Mix 12 oz', category: 'House-Made', kind: 'made', uom: 'ea', price: 7.99, cost: 3.03,
    sup: null, base: 5, season: 'trail', pack: 12, mpu: 1.2, lead: 1 },
  { sku: 'SD-3002', name: 'Caramel Popcorn 8 oz', category: 'House-Made', kind: 'made', uom: 'ea', price: 4.99, cost: 1.28,
    sup: null, base: 5, season: 'popcorn', pack: 12, mpu: 1.5, lead: 1 },
  { sku: 'SD-3003', name: 'Cheddar Popcorn 8 oz', category: 'House-Made', kind: 'made', uom: 'ea', price: 4.99, cost: 1.43,
    sup: null, base: 4, season: 'popcorn', pack: 12, mpu: 1.4, lead: 1 },
  { sku: 'SD-4001', name: 'Movie Night Box', category: 'Gift Boxes', kind: 'kit', uom: 'ea', price: 14.99, cost: 5.70,
    sup: null, base: 1.0, season: 'gift', pack: 1, mpu: 3, lead: 1 },
  { sku: 'SD-4002', name: 'Game Day Box', category: 'Gift Boxes', kind: 'kit', uom: 'ea', price: 24.99, cost: 11.23,
    sup: null, base: 0.6, season: 'salty', pack: 1, mpu: 3.5, lead: 1 },
  { sku: 'SD-4003', name: 'Sweet Tooth Box', category: 'Gift Boxes', kind: 'kit', uom: 'ea', price: 16.99, cost: 6.35,
    sup: null, base: 0.8, season: 'gift', pack: 1, mpu: 3, lead: 1 },
]

// Single-level bills of material: parent SKU → [component SKU, qty per parent]
export const BOMS: Record<string, [string, number][]> = {
  'SD-3001': [['SD-2001', 0.2], ['SD-2002', 0.25], ['SD-2003', 0.1], ['SD-2004', 0.15], ['SD-2005', 0.1], ['SD-2101', 1], ['SD-2104', 1]],
  'SD-3002': [['SD-2006', 0.35], ['SD-2007', 0.12], ['SD-2008', 0.2], ['SD-2010', 0.05], ['SD-2102', 1], ['SD-2104', 1]],
  'SD-3003': [['SD-2006', 0.4], ['SD-2009', 0.1], ['SD-2010', 0.06], ['SD-2007', 0.05], ['SD-2102', 1], ['SD-2104', 1]],
  'SD-4001': [['SD-3002', 1], ['SD-3003', 1], ['SD-1203', 1], ['SD-1101', 2], ['SD-2103', 1], ['SD-2104', 1]],
  'SD-4002': [['SD-1001', 1], ['SD-1002', 1], ['SD-1004', 1], ['SD-1103', 2], ['SD-3001', 1], ['SD-2103', 1], ['SD-2104', 1]],
  'SD-4003': [['SD-1201', 1], ['SD-1202', 2], ['SD-1204', 2], ['SD-1205', 1], ['SD-2103', 1], ['SD-2104', 1]],
}

export const CUSTOMERS = [
  { name: 'Provo Tech Hub', email: 'office@provotechhub.example', phone: '(801) 555-0110', kind: 'business', city: 'Provo' },
  { name: 'Riverwoods Family Dental', email: 'frontdesk@riverwoodsdental.example', phone: '(801) 555-0122', kind: 'business', city: 'Provo' },
  { name: 'Timpanogos High Booster Club', email: 'boosters@timphigh.example', phone: '(801) 555-0133', kind: 'business', city: 'Orem' },
  { name: 'Lakeside Youth Soccer', email: 'snacks@lakesidesoccer.example', phone: '(801) 555-0144', kind: 'business', city: 'Orem' },
  { name: 'Orem Rec Center Concessions', email: 'concessions@oremrec.example', phone: '(801) 555-0155', kind: 'business', city: 'Orem' },
  { name: 'Canyon View Realty', email: 'events@canyonviewrealty.example', phone: '(385) 555-0166', kind: 'business', city: 'Lindon' },
  { name: 'Emma Larsen', email: 'emma.larsen@example.com', phone: '(801) 555-0177', kind: 'individual', city: 'Provo' },
  { name: 'Marcus Chen', email: 'marcus.chen@example.com', phone: '(801) 555-0188', kind: 'individual', city: 'Orem' },
  { name: 'Sofia Ramirez', email: 'sofia.ramirez@example.com', phone: '(385) 555-0199', kind: 'individual', city: 'Provo' },
  { name: 'Tyler Jensen', email: 'tyler.jensen@example.com', phone: '(801) 555-0105', kind: 'individual', city: 'Springville' },
  { name: 'Hannah Brooks', email: 'hannah.brooks@example.com', phone: '(801) 555-0116', kind: 'individual', city: 'Provo' },
  { name: 'Daniel Okafor', email: 'daniel.okafor@example.com', phone: '(385) 555-0127', kind: 'individual', city: 'Orem' },
] as const

// UPC-A: 11 digits + check digit, so labels scan on any retail scanner.
export function upc(itemNumber: number): string {
  const body = '85001' + String(itemNumber).padStart(6, '0')
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0)
  return body + ((10 - (sum % 10)) % 10)
}
