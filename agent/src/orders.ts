/**
 * The demo order book for Harbor Goods. Dates are computed from the day of
 * the lookup, so the in-process order is always due two days from today.
 */

export type OrderStatus = 'in_process' | 'shipped' | 'delivered';

export interface OrderRecord {
  orderNumber: string;
  customerName: string;
  /** Spoken name of the product, lowercase, as in "linen throw blanket". */
  item: string;
  /** Title shown on the order card. */
  title: string;
  /** Color, size, or set, shown under the title and available if the caller asks. */
  detail: string;
  quantity: number;
  totalCents: number;
  city: string;
  /** Path the support desk serves. Kept out of the spoken reply. */
  image: string;
  status: OrderStatus;
  /** Days from the lookup date until delivery. Negative means it already arrived. */
  deliveryInDays: number;
  /** Days before the lookup date that the order was placed. */
  placedDaysAgo: number;
}

export interface OrderStep {
  label: string;
  state: 'done' | 'current' | 'upcoming';
}

/** What the support desk draws when an order is on screen. */
export interface OrderCard {
  customerName: string;
  orderNumber: string;
  item: string;
  title: string;
  detail: string;
  quantity: number;
  total: string;
  placedLabel: string;
  shipsTo: string;
  image: string;
  status: OrderStatus;
  statusLabel: string;
  deliveryLabel: string;
  steps: OrderStep[];
}

export interface FoundOrder {
  outcome: 'found';
  customerName: string;
  orderNumber: string;
  item: string;
  detail: string;
  quantity: number;
  total: string;
  placedDate: string;
  city: string;
  status: OrderStatus;
  statusLabel: string;
  deliveryDate: string;
  /** "in 2 days", "tomorrow", "yesterday", and so on. */
  deliveryRelative: string;
  /** The status sentence to speak. The date in it is the one to say. */
  say: string;
  card: OrderCard;
}

export type LookupResult =
  | FoundOrder
  | { outcome: 'need_name' }
  | { outcome: 'none' }
  | { outcome: 'many'; names: string[] }
  | { outcome: 'mismatch' };

const STATUS_LABEL: Record<OrderStatus, string> = {
  in_process: 'In process',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

const STEP_LABELS = ['Placed', 'In process', 'Shipped', 'Delivered'] as const;

const STATUS_INDEX: Record<OrderStatus, number> = {
  in_process: 1,
  shipped: 2,
  delivered: 3,
};

export const ORDERS: readonly OrderRecord[] = [
  {
    orderNumber: '1842',
    customerName: 'Maya Chen',
    item: 'linen throw blanket',
    title: 'Linen throw blanket',
    detail: 'Oatmeal, 50 by 60 inches',
    quantity: 1,
    totalCents: 14800,
    city: 'Brooklyn',
    image: '/products/linen-throw.jpg',
    status: 'in_process',
    deliveryInDays: 2,
    placedDaysAgo: 1,
  },
  {
    orderNumber: '1904',
    customerName: 'Andre Walsh',
    item: 'ceramic pour-over set',
    title: 'Ceramic pour-over set',
    detail: 'Speckled sand, dripper and cup',
    quantity: 1,
    totalCents: 8600,
    city: 'Portland',
    image: '/products/pour-over.jpg',
    status: 'shipped',
    deliveryInDays: 1,
    placedDaysAgo: 4,
  },
  {
    orderNumber: '1760',
    customerName: 'Priya Shah',
    item: 'wool overcoat',
    title: 'Wool overcoat',
    detail: 'Camel, size medium',
    quantity: 1,
    totalCents: 42000,
    city: 'Chicago',
    image: '/products/wool-coat.jpg',
    status: 'delivered',
    deliveryInDays: -1,
    placedDaysAgo: 12,
  },
  {
    orderNumber: '2018',
    customerName: 'Jonah Ellis',
    item: 'stoneware dinner plates',
    title: 'Stoneware dinner plates',
    detail: 'Warm grey, set of four',
    quantity: 1,
    totalCents: 9600,
    city: 'Austin',
    image: '/products/dinner-plates.jpg',
    status: 'in_process',
    deliveryInDays: 3,
    placedDaysAgo: 0,
  },
  {
    orderNumber: '1888',
    customerName: 'Lena Okonkwo',
    item: 'beeswax pillar candles',
    title: 'Beeswax pillar candles',
    detail: 'Honey, set of three',
    quantity: 1,
    totalCents: 4200,
    city: 'Denver',
    image: '/products/beeswax-candles.jpg',
    status: 'shipped',
    deliveryInDays: 2,
    placedDaysAgo: 3,
  },
  {
    orderNumber: '1695',
    customerName: 'Samir Haddad',
    item: 'oak cutting board',
    title: 'Oak cutting board',
    detail: 'Walnut edge, 12 by 18 inches',
    quantity: 1,
    totalCents: 6400,
    city: 'Seattle',
    image: '/products/cutting-board.jpg',
    status: 'delivered',
    deliveryInDays: -3,
    placedDaysAgo: 9,
  },
];

function day(today: Date, offset: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
}

function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function money(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function relative(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

function steps(status: OrderStatus): OrderStep[] {
  const current = STATUS_INDEX[status];
  return STEP_LABELS.map((label, index) => ({
    label,
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
  }));
}

function present(order: OrderRecord, today: Date): FoundOrder {
  const deliveryDate = formatDay(day(today, order.deliveryInDays));
  const placedDate = formatDay(day(today, -order.placedDaysAgo));
  const deliveryRelative = relative(order.deliveryInDays);
  const statusLabel = STATUS_LABEL[order.status];
  const total = money(order.totalCents);
  const say =
    order.status === 'delivered'
      ? `${order.customerName}'s ${order.item}, order ${order.orderNumber}, was delivered ${deliveryRelative}, on ${deliveryDate}.`
      : `${order.customerName}'s ${order.item}, order ${order.orderNumber}, is ${statusLabel.toLowerCase()} and should be delivered ${deliveryRelative}, on ${deliveryDate}.`;
  const deliveryLabel =
    order.status === 'delivered' ? `Delivered ${deliveryDate}` : `Arrives ${deliveryDate}`;
  return {
    outcome: 'found',
    customerName: order.customerName,
    orderNumber: order.orderNumber,
    item: order.item,
    detail: order.detail,
    quantity: order.quantity,
    total,
    placedDate,
    city: order.city,
    status: order.status,
    statusLabel,
    deliveryDate,
    deliveryRelative,
    say,
    card: {
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      item: order.item,
      title: order.title,
      detail: order.detail,
      quantity: order.quantity,
      total,
      placedLabel: placedDate,
      shipsTo: order.city,
      image: order.image,
      status: order.status,
      statusLabel,
      deliveryLabel,
      steps: steps(order.status),
    },
  };
}

/**
 * Whether the tool arguments came from the caller's latest words.
 * The model otherwise invents a customer, and the first one in the book
 * (Maya Chen) gets shown on every call.
 */
export function callerSupplied(
  transcript: string,
  input: { customerName?: string; orderNumber?: string },
): 'ok' | 'not_yet' | 'not_said' {
  const text = transcript.trim();
  if (!text || text === '[caller connected]' || text === '[no response]' || text === '[unintelligible]') {
    return 'not_yet';
  }
  const said = new Set(wordsOf(text));
  const nameWords = wordsOf(input.customerName ?? '').filter((word) => word.length >= 3);
  const digits = (input.orderNumber ?? '').replace(/\D/g, '');
  const saidDigits = text.replace(/\D/g, '');
  if (nameWords.length > 0 && !nameWords.some((word) => said.has(word))) return 'not_said';
  if (digits.length >= 4 && !saidDigits.includes(digits)) return 'not_said';
  if (nameWords.length === 0 && digits.length < 4) return 'not_yet';
  return 'ok';
}

function wordsOf(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function nameHits(query: string[]): OrderRecord[] {
  return ORDERS.filter((order) => {
    const names = order.customerName.toLowerCase().split(/\s+/);
    return names.some((name) => query.includes(name));
  });
}

/**
 * Match a name or order number the caller actually said.
 * An order number that belongs to someone else is a mismatch, not a hit.
 */
export function lookupOrder(
  input: { customerName?: string; orderNumber?: string },
  today = new Date(),
): LookupResult {
  const blob = [input.customerName, input.orderNumber].filter(Boolean).join(' ').trim();
  if (!blob) return { outcome: 'need_name' };

  const query = wordsOf(blob);
  const digits = (input.orderNumber ?? blob).replace(/\D/g, '');
  const byNumber = digits.length >= 4 ? ORDERS.filter((order) => order.orderNumber === digits) : [];
  const byName = nameHits(query);

  if (byNumber.length === 1) {
    const order = byNumber[0];
    if (byName.length > 0 && !byName.some((hit) => hit.orderNumber === order.orderNumber)) {
      return { outcome: 'mismatch' };
    }
    return present(order, today);
  }

  if (byName.length === 1) return present(byName[0], today);
  if (byName.length > 1) return { outcome: 'many', names: byName.map((order) => order.customerName) };
  return { outcome: 'none' };
}

/** A short text result for the model. The `say` line is the status to speak. */
export function describeLookup(result: LookupResult, shown: boolean): string {
  switch (result.outcome) {
    case 'need_name':
      return 'No name or order number was given. Ask the caller for the name on the order.';
    case 'none':
      return 'No order matched. Ask the caller to repeat their name.';
    case 'many':
      return `More than one customer matched: ${result.names.join(', ')}. Ask which person is calling. Do not guess.`;
    case 'mismatch':
      return 'That order number is not under the name they gave. Ask them to repeat the name or the number. Do not read out anyone else\'s order.';
    case 'found':
      return [
        'outcome: found',
        `customer: ${result.customerName}`,
        `order: ${result.orderNumber}`,
        `item: ${result.item}`,
        `detail: ${result.detail}`,
        `quantity: ${result.quantity}`,
        `total: ${result.total}`,
        `placed: ${result.placedDate}`,
        `ships to: ${result.city}`,
        `status: ${result.statusLabel}`,
        `delivery: ${result.deliveryDate} (${result.deliveryRelative})`,
        `say: ${result.say}`,
        shown
          ? 'screen: the order is now on the caller\'s screen, so do not read every field aloud.'
          : 'screen: the order card could not be shown. Tell them the status anyway.',
      ].join('\n');
  }
}
