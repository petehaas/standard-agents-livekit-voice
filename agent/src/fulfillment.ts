/**
 * Tracking, delivery changes, and returns for the demo order book.
 *
 * Everything here is plain data and pure functions. The tools in
 * agents/tools/ keep call state in thread values and push cards to the
 * caller's screen. The model never applies a change itself: it can only
 * request one, and the change is applied after the caller says yes.
 */
import { day, deliveryDays, formatDay, money, ORDERS, present, type OrderChanges, type OrderRecord } from './orders.ts';

/** Thread value keys. */
export const CURRENT_ORDER_KEY = 'hg_current_order';
export const CHANGES_KEY = 'hg_order_changes';
export const PENDING_KEY = 'hg_pending_change';

/** A fictional carrier, so the demo does not imitate a real one. */
export const CARRIER = 'Parcelway';

export interface Stop {
  name: string;
  lat: number;
  lon: number;
}

interface TrackingPlan {
  trackingNumber: string;
  /** Warehouse first, the caller's city last. */
  stops: Stop[];
  /** How far along the route the package is, in stops (0 = warehouse, stops.length - 1 = delivered). */
  progress: number;
  /** Scan history, oldest first. `day` is days from today, `time` is local clock time. */
  scans: { day: number; time: string; label: string; place: string }[];
}

const LOUISVILLE: Stop = { name: 'Louisville, KY', lat: 38.25, lon: -85.76 };
const CITY: Record<string, Stop> = {
  Brooklyn: { name: 'Brooklyn, NY', lat: 40.68, lon: -73.94 },
  Portland: { name: 'Portland, OR', lat: 45.52, lon: -122.68 },
  Chicago: { name: 'Chicago, IL', lat: 41.88, lon: -87.63 },
  Austin: { name: 'Austin, TX', lat: 30.27, lon: -97.74 },
  Denver: { name: 'Denver, CO', lat: 39.74, lon: -104.99 },
};
const HUB = {
  pittsburgh: { name: 'Pittsburgh, PA', lat: 40.44, lon: -79.99 },
  kansasCity: { name: 'Kansas City, MO', lat: 39.1, lon: -94.58 },
  saltLake: { name: 'Salt Lake City, UT', lat: 40.76, lon: -111.89 },
  boise: { name: 'Boise, ID', lat: 43.62, lon: -116.2 },
  indianapolis: { name: 'Indianapolis, IN', lat: 39.77, lon: -86.16 },
  memphis: { name: 'Memphis, TN', lat: 35.15, lon: -90.05 },
  dallas: { name: 'Dallas, TX', lat: 32.78, lon: -96.8 },
  stLouis: { name: 'St. Louis, MO', lat: 38.63, lon: -90.2 },
};

const PLANS: Record<string, TrackingPlan> = {
  '111': {
    trackingNumber: 'PW 4471 2093 1186',
    stops: [LOUISVILLE, HUB.pittsburgh, CITY.Brooklyn],
    progress: 0,
    scans: [
      { day: -1, time: '4:18 pm', label: 'Order placed', place: 'harborgoods.com' },
      { day: 0, time: '8:40 am', label: 'Packing at the warehouse', place: LOUISVILLE.name },
    ],
  },
  '222': {
    trackingNumber: 'PW 4471 2093 2240',
    stops: [LOUISVILLE, HUB.kansasCity, HUB.saltLake, HUB.boise, CITY.Portland],
    progress: 3.35,
    scans: [
      { day: -3, time: '3:05 pm', label: 'Picked up', place: LOUISVILLE.name },
      { day: -2, time: '2:12 am', label: 'Departed facility', place: HUB.kansasCity.name },
      { day: -1, time: '9:47 am', label: 'Departed facility', place: HUB.saltLake.name },
      { day: 0, time: '5:31 am', label: 'Departed facility', place: HUB.boise.name },
      { day: 0, time: '7:02 am', label: 'In transit to the local depot', place: 'Pendleton, OR' },
    ],
  },
  '333': {
    trackingNumber: 'PW 4471 2093 3317',
    stops: [LOUISVILLE, HUB.indianapolis, CITY.Chicago],
    progress: 2,
    scans: [
      { day: -4, time: '1:20 pm', label: 'Picked up', place: LOUISVILLE.name },
      { day: -3, time: '11:58 pm', label: 'Departed facility', place: HUB.indianapolis.name },
      { day: -2, time: '6:44 am', label: 'Out for delivery', place: CITY.Chicago.name },
      { day: -1, time: '2:16 pm', label: 'Delivered, front porch', place: CITY.Chicago.name },
    ],
  },
  '444': {
    trackingNumber: 'PW 4471 2093 4452',
    stops: [LOUISVILLE, HUB.memphis, HUB.dallas, CITY.Austin],
    progress: 0,
    scans: [{ day: 0, time: '10:05 am', label: 'Order placed', place: 'harborgoods.com' }],
  },
  '555': {
    trackingNumber: 'PW 4471 2093 5528',
    stops: [LOUISVILLE, HUB.stLouis, HUB.kansasCity, CITY.Denver],
    progress: 1.55,
    scans: [
      { day: -2, time: '4:40 pm', label: 'Picked up', place: LOUISVILLE.name },
      { day: -1, time: '3:22 am', label: 'Departed facility', place: HUB.stLouis.name },
      { day: 0, time: '6:15 am', label: 'In transit on I-70', place: 'Columbia, MO' },
    ],
  },
};

export function findOrder(orderNumber: string | null | undefined): OrderRecord | undefined {
  return ORDERS.find((order) => order.orderNumber === orderNumber);
}

function scanDay(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  return formatDay(day(new Date(), offset)).split(',')[0];
}

/** Card the support desk draws as a map and a scan timeline. */
export interface TrackingCard {
  kind: 'tracking';
  orderNumber: string;
  title: string;
  carrier: string;
  trackingNumber: string;
  statusLabel: string;
  etaLabel: string;
  stops: Stop[];
  progress: number;
  /** Newest first. */
  scans: { when: string; label: string; place: string }[];
  instructions?: string;
}

export function trackPackage(order: OrderRecord, today: Date, changes: OrderChanges = {}) {
  const plan = PLANS[order.orderNumber];
  const found = present(order, today, changes);
  const last = plan.scans[plan.scans.length - 1];
  const delivered = order.status === 'delivered';
  const shipped = order.status === 'shipped';
  const nextStop = plan.stops[Math.min(plan.stops.length - 1, Math.floor(plan.progress) + 1)];

  const card: TrackingCard = {
    kind: 'tracking',
    orderNumber: order.orderNumber,
    title: order.title,
    carrier: CARRIER,
    trackingNumber: plan.trackingNumber,
    statusLabel: found.statusLabel,
    etaLabel: delivered ? `Delivered ${found.deliveryDate}` : `Arrives ${found.deliveryDate}`,
    stops: plan.stops,
    progress: plan.progress,
    scans: [...plan.scans].reverse().map((scan) => ({
      when: `${scanDay(scan.day)}, ${scan.time}`,
      label: scan.label,
      place: scan.place,
    })),
    instructions: changes.instructions,
  };

  const where = delivered
    ? `It was delivered ${found.deliveryRelative}: ${last.label.toLowerCase()} in ${last.place}.`
    : shipped
      ? `Latest scan: ${last.label.toLowerCase()}, ${last.place}, ${scanDay(last.day).toLowerCase()} at ${last.time}. Next stop: ${nextStop.name}.`
      : `It has not shipped yet. It is ${last.label.toLowerCase()} in ${last.place}, and the label is ready.`;
  const result = [
    'outcome: tracking',
    `carrier: ${CARRIER}`,
    `tracking number: ${plan.trackingNumber} (on screen; do not read it aloud unless asked)`,
    `route: ${plan.stops.map((stop) => stop.name).join(' to ')}`,
    `where: ${where}`,
    `delivery: ${found.deliveryDate} (${found.deliveryRelative})`,
    'say: one or two sentences on where it is now and when it arrives. The map is on their screen.',
  ].join('\n');
  return { card, result };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, 'twenty first': 21, 'twenty second': 22, 'twenty third': 23,
  'twenty fourth': 24, 'twenty fifth': 25, 'twenty sixth': 26, 'twenty seventh': 27, 'twenty eighth': 28,
  'twenty ninth': 29, thirtieth: 30, 'thirty first': 31,
};
const SMALL: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * Turn a spoken day into days from today: "Monday", "next Tuesday",
 * "tomorrow", "the day after tomorrow", "in three days", "December 2nd".
 * Returns null when it is not a day.
 */
export function parseDay(text: string, today: Date): number | null {
  const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/\bday after tomorrow\b/.test(t)) return 2;
  if (/\btomorrow\b/.test(t)) return 1;
  if (/\btoday\b/.test(t)) return 0;
  const inDays = /\bin (\d+|[a-z]+) days?\b/.exec(t);
  if (inDays) {
    const n = /^\d+$/.test(inDays[1]) ? Number(inDays[1]) : SMALL[inDays[1]];
    if (n) return n;
  }
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(t));
  if (weekday >= 0) {
    let ahead = (weekday - today.getDay() + 7) % 7 || 7;
    if (/\bnext\b/.test(t) && ahead < 7) ahead += 7;
    return ahead;
  }
  const month = MONTHS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(t));
  let dayOfMonth: number | undefined;
  const digits = /\b(\d{1,2})(st|nd|rd|th)?\b/.exec(t);
  if (digits) dayOfMonth = Number(digits[1]);
  else {
    const word = Object.keys(ORDINALS).sort((a, b) => b.length - a.length).find((w) => new RegExp(`\\b${w}\\b`).test(t));
    if (word) dayOfMonth = ORDINALS[word];
  }
  if (dayOfMonth && (month >= 0 || /\bthe\b/.test(t))) {
    const year = today.getFullYear();
    let target = new Date(year, month >= 0 ? month : today.getMonth(), dayOfMonth);
    const start = new Date(year, today.getMonth(), today.getDate());
    if (target < start) target = new Date(month >= 0 ? year + 1 : year, month >= 0 ? month : today.getMonth() + 1, dayOfMonth);
    return Math.round((target.getTime() - start.getTime()) / 86_400_000);
  }
  return null;
}

/** A change the caller asked for, waiting for their yes. */
export type PendingChange =
  | { type: 'delivery'; orderNumber: string; deliveryInDays?: number; instructions?: string; summary: string }
  | { type: 'return'; orderNumber: string; reason: string; summary: string };

/** Latest delivery day a caller can pick, in days from today. */
export const LATEST_DELIVERY_DAYS = 10;
export const RETURN_WINDOW_DAYS = 30;

export type Plan = { ok: true; pending: PendingChange } | { ok: false; reason: string };

export function planDeliveryChange(
  order: OrderRecord,
  request: { day?: string; instructions?: string },
  today: Date,
  changes: OrderChanges = {},
): Plan {
  if (order.status === 'delivered') return { ok: false, reason: 'This order was already delivered, so its delivery cannot change. A return is possible.' };
  if (!request.day && !request.instructions) return { ok: false, reason: 'Ask what they would like to change: the delivery day, or where to leave it.' };

  let deliveryInDays: number | undefined;
  if (request.day) {
    const parsed = parseDay(request.day, today);
    if (parsed === null) return { ok: false, reason: `"${request.day}" is not a day. Ask which day they would like instead.` };
    const earliest = deliveryDays(order, today);
    if (parsed < earliest) {
      return { ok: false, reason: `It cannot arrive sooner than ${formatDay(day(today, earliest))}. Offer that day or a later one.` };
    }
    if (parsed > LATEST_DELIVERY_DAYS) {
      return { ok: false, reason: `Delivery can be held until ${formatDay(day(today, LATEST_DELIVERY_DAYS))} at the latest.` };
    }
    if (parsed === (changes.deliveryInDays ?? deliveryDays(order, today))) {
      return { ok: false, reason: `It is already due ${formatDay(day(today, parsed))}. Nothing to change.` };
    }
    if (day(today, parsed).getDay() === 0) return { ok: false, reason: `${CARRIER} does not deliver on Sundays. Offer Monday instead.` };
    deliveryInDays = parsed;
  }
  const instructions = request.instructions?.trim().replace(/\.$/, '') || undefined;
  if (instructions && instructions.length > 120) return { ok: false, reason: 'Those instructions are too long. Ask for a short version.' };

  const parts = [
    deliveryInDays !== undefined ? `deliver on ${formatDay(day(today, deliveryInDays))}` : '',
    instructions ? `leave it: ${instructions}` : '',
  ].filter(Boolean);
  return {
    ok: true,
    // Only set fields go in: thread values must be plain JSON, and runtimes may refuse undefined.
    pending: {
      type: 'delivery',
      orderNumber: order.orderNumber,
      ...(deliveryInDays !== undefined ? { deliveryInDays } : {}),
      ...(instructions ? { instructions } : {}),
      summary: parts.join(', and '),
    },
  };
}

export function planReturn(order: OrderRecord, reason: string, changes: OrderChanges = {}): Plan {
  if (order.status !== 'delivered') {
    return { ok: false, reason: 'A return can start once the order is delivered. Changing the delivery is possible now.' };
  }
  if (changes.returnCode) return { ok: false, reason: `A return is already started, return code ${changes.returnCode}.` };
  if (-order.deliveryInDays > RETURN_WINDOW_DAYS) return { ok: false, reason: `The ${RETURN_WINDOW_DAYS}-day return window has passed.` };
  const why = reason.trim() || 'no reason given';
  return {
    ok: true,
    pending: {
      type: 'return',
      orderNumber: order.orderNumber,
      reason: why,
      summary: `return the ${order.item} for a refund of ${money(order.totalCents)} (${why})`,
    },
  };
}

/** A return code that is easy to say: R, the order number, and two digits. */
export function returnCode(orderNumber: string): string {
  const n = Number(orderNumber);
  return `R${orderNumber}${String((n * 37) % 90 + 10)}`;
}

/** Apply a confirmed change. Returns the order's new changes. */
export function applyChange(pending: PendingChange, current: OrderChanges = {}): OrderChanges {
  if (pending.type === 'return') {
    return { ...current, returnCode: returnCode(pending.orderNumber), returnReason: pending.reason };
  }
  return {
    ...current,
    ...(pending.deliveryInDays !== undefined ? { deliveryInDays: pending.deliveryInDays } : {}),
    ...(pending.instructions ? { instructions: pending.instructions } : {}),
  };
}

const YES = /\b(yes|yeah|yep|yup|sure|correct|right|confirm(ed)?|go ahead|do it|please do|sounds good|that works|perfect|absolutely|okay|ok|great)\b/;
const NO = /\b(no|nope|nah|don'?t|do not|cancel|wait|hold on|stop|never ?mind|not)\b/;

/**
 * Did the caller just say yes? The confirm tool checks this against the
 * caller's own latest words, so the model cannot approve a change by itself.
 */
export function isAffirmative(text: string): boolean {
  const t = text.toLowerCase().replace(/[’]/g, "'");
  return YES.test(t) && !NO.test(t.replace(/\bno problem\b/g, ''));
}

/** Card shown while a change waits for the caller's yes. */
export interface ConfirmCard {
  kind: 'confirm';
  orderNumber: string;
  title: string;
  heading: string;
  lines: string[];
}

export function confirmCard(order: OrderRecord, pending: PendingChange, today: Date): ConfirmCard {
  const lines =
    pending.type === 'return'
      ? [`Refund ${money(order.totalCents)} to the original payment`, `Reason: ${pending.reason}`]
      : [
          pending.deliveryInDays !== undefined ? `Deliver ${formatDay(day(today, pending.deliveryInDays))}` : '',
          pending.instructions ? `Leave it: ${pending.instructions}` : '',
        ].filter(Boolean);
  return {
    kind: 'confirm',
    orderNumber: order.orderNumber,
    title: order.title,
    heading: pending.type === 'return' ? 'Start a return?' : 'Change this delivery?',
    lines,
  };
}

