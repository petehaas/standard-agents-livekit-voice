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
  /** Nothing that sounds like an order number was said. */
  | { outcome: 'need_number' }
  /** Digits were heard, but not one clear three-digit order number. */
  | { outcome: 'incomplete'; heard: string }
  /** Three digits, but no such order. */
  | { outcome: 'none'; orderNumber: string };

/** Order numbers are always this many digits. Short enough to say, easy to hear. */
export const ORDER_NUMBER_DIGITS = 3;

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
    orderNumber: '111',
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
    orderNumber: '222',
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
    orderNumber: '333',
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
    orderNumber: '444',
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
    orderNumber: '555',
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
      ? `${order.customerName}'s ${order.item}, order ${order.orderNumber.split('').join(' ')}, was delivered ${deliveryRelative}, on ${deliveryDate}.`
      : `${order.customerName}'s ${order.item}, order ${order.orderNumber.split('').join(' ')}, is ${statusLabel.toLowerCase()} and should be delivered ${deliveryRelative}, on ${deliveryDate}.`;
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

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4',
  five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9',
};
const TEENS: Record<string, string> = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
};
const TENS: Record<string, string> = {
  twenty: '2', thirty: '3', forty: '4', fifty: '5', sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};

/**
 * Turn what the caller said into the digits of an order number.
 *
 * Speech-to-text usually writes "111", but callers also say "one one one",
 * "triple one", "one eleven", or "three hundred thirty three", and STT
 * sometimes keeps those as words. Returns the digits in order; the caller
 * checks the length. Word-number guessing is deliberately limited to the
 * forms people use for short codes.
 */
export function spokenDigits(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/(\d)/g, ' $1 ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (/^\d$/.test(token)) out += token;
    else if ((token === 'double' || token === 'triple') && next && (DIGIT_WORDS[next] || /^\d$/.test(next))) {
      out += (DIGIT_WORDS[next] ?? next).repeat(token === 'double' ? 2 : 3);
      i++;
    } else if (token === 'hundred') {
      // "three hundred" -> 300 placeholder; the following words fill the zeros.
      const rest = tokens.slice(i + 1).join(' ');
      const tail = spokenDigits(rest.replace(/^and\s+/, ''));
      out += tail.length >= 2 ? tail.slice(0, 2) : tail.length === 1 ? `0${tail}` : '00';
      break;
    } else if (TEENS[token]) out += TEENS[token];
    else if (TENS[token]) {
      const unit = next ? DIGIT_WORDS[next] : undefined;
      if (unit && unit !== '0') {
        out += TENS[token] + unit;
        i++;
      } else out += `${TENS[token]}0`;
    } else if (DIGIT_WORDS[token] && !(token === 'o' || token === 'to' || token === 'too' || token === 'for' || token === 'ate') ) {
      out += DIGIT_WORDS[token];
    } else if ((token === 'to' || token === 'too' || token === 'for' || token === 'ate' || token === 'o') && out.length > 0 && out.length < ORDER_NUMBER_DIGITS) {
      // Homophones count only mid-number ("one to one"), never as ordinary words.
      out += DIGIT_WORDS[token];
    }
  }
  return out;
}

/**
 * Find the order the caller asked for.
 *
 * `spoken` is the caller's latest words. When they hold a full number, they
 * win. Otherwise ("yes, that one") the model's `orderNumber` is used, but
 * only if the caller said those digits earlier in the call (`earlier`), so
 * the model can refer back to an order but never invent one.
 */
export function lookupOrder(
  input: { spoken?: string; orderNumber?: string; earlier?: string[] },
  today = new Date(),
): LookupResult {
  const fromWords = spokenDigits(input.spoken ?? '');
  const fromModel = spokenDigits(input.orderNumber ?? '');
  const saidBefore =
    fromModel.length === ORDER_NUMBER_DIGITS &&
    [input.spoken ?? '', ...(input.earlier ?? [])].some((text) => spokenDigits(text).includes(fromModel));
  const digits = fromWords.length >= ORDER_NUMBER_DIGITS || !saidBefore ? fromWords : fromModel;
  if (!digits) return { outcome: 'need_number' };
  if (digits.length < ORDER_NUMBER_DIGITS) return { outcome: 'incomplete', heard: digits };
  // Extra digits ("I bought 2, order 444") are fine if exactly one real order is inside them.
  const matches = ORDERS.filter((candidate) =>
    digits.length === ORDER_NUMBER_DIGITS ? candidate.orderNumber === digits : digits.includes(candidate.orderNumber),
  );
  const order = matches.length === 1 ? matches[0] : undefined;
  if (!order && digits.length > ORDER_NUMBER_DIGITS) return { outcome: 'incomplete', heard: digits };
  return order ? present(order, today) : { outcome: 'none', orderNumber: digits };
}

/** A short text result for the model. The `say` line is the status to speak. */
export function describeLookup(result: LookupResult, shown: boolean): string {
  switch (result.outcome) {
    case 'need_number':
      return 'The caller has not said an order number yet. Ask for their three-digit order number.';
    case 'incomplete':
      return `Heard the digits ${result.heard.split('').join(' ')}, which is not one three-digit order number. Ask them to say just the three-digit number.`;
    case 'none':
      return `There is no order ${result.orderNumber.split('').join(' ')}. Say you could not find that number and ask them to say it again.`;
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
