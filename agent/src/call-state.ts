/**
 * Call state the order tools share, kept in durable thread values: which
 * order is on screen, what the caller changed, and a change waiting for
 * their yes. Code owns this state; the model only asks for changes.
 */
import type { ThreadState } from '@standardagents/spec';
import { showCard } from '@petehaas/standard-agents-livekit-voice';
import { CHANGES_KEY, CURRENT_ORDER_KEY, findOrder, PENDING_KEY, type PendingChange } from './fulfillment.ts';
import type { OrderChanges, OrderRecord } from './orders.ts';

export async function allChanges(state: ThreadState): Promise<Record<string, OrderChanges>> {
  return (await state.getValue<Record<string, OrderChanges>>(CHANGES_KEY)) ?? {};
}

export async function currentOrder(state: ThreadState): Promise<OrderRecord | undefined> {
  return findOrder(await state.getValue<string>(CURRENT_ORDER_KEY));
}

export async function setCurrentOrder(state: ThreadState, orderNumber: string) {
  await state.setValue(CURRENT_ORDER_KEY, orderNumber);
}

export async function pendingChange(state: ThreadState): Promise<PendingChange | null> {
  return state.getValue<PendingChange>(PENDING_KEY);
}

/** Thread values must be plain JSON. This drops undefined fields, which runtimes may refuse. */
function plain<T>(value: T): T {
  return value === null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export async function setPending(state: ThreadState, pending: PendingChange | null) {
  await state.setValue(PENDING_KEY, plain(pending));
}

export async function saveChanges(state: ThreadState, orderNumber: string, changes: OrderChanges) {
  await state.setValue(CHANGES_KEY, plain({ ...(await allChanges(state)), [orderNumber]: changes }));
}

/** The caller's words, newest first. */
export async function callerWords(state: ThreadState, limit = 30): Promise<string[]> {
  const { messages } = await state.getMessages({ limit, order: 'desc' });
  return messages.filter((message) => message.role === 'user' && message.content).map((message) => message.content!);
}

/** Put a card on the caller's screen. Returns false when no screen is attached. */
export async function show(state: ThreadState, card: object): Promise<boolean> {
  if (!state.runtimeStreams) return false;
  const pushed = await showCard(state.runtimeStreams, { ...card });
  return pushed.ok;
}

export const NO_ORDER = 'No order is on screen yet. Ask for their three-digit order number and look it up first.';
