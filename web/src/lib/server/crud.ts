import { json, type RequestHandler } from '@sveltejs/kit';
import type { externalReviewers, personas } from './config.js';
import type { personaFields } from './fields.js';
import { badRequest, bodyOf, noContent, notFound } from './http.js';

// The routes for a list kept in settings - personas, external reviewers -
// to list, add and reorder them, and to change or remove one.

type Store = typeof personas | typeof externalReviewers;
type Check = typeof personaFields;

export function collectionRoutes(store: Store, check: Check, extra: () => object = () => ({})): Record<'GET' | 'POST' | 'PUT', RequestHandler> {
	return {
		GET: () => json({ items: store.list(), ...extra() }),
		POST: async ({ request }) => {
			const checked = check(await bodyOf(request), false);
			if ('error' in checked) return json(checked, { status: 400 });
			const fields = Object.fromEntries(Object.entries(checked.fields).filter(([, v]) => v !== null));
			return json({ item: (store.add as (f: Record<string, unknown>) => object)(fields) });
		},
		PUT: async ({ request }) => {
			const order = (await bodyOf(request)).order;
			const items = Array.isArray(order) && order.every((id) => typeof id === 'string') ? store.reorder(order) : null;
			if (!items) return badRequest('The order has to list each one once.');
			return json({ items });
		}
	};
}

export function itemRoutes(store: Store, check: Check): Record<'PUT' | 'DELETE', RequestHandler> {
	return {
		PUT: async ({ request, params }) => {
			const checked = check(await bodyOf(request), true);
			if ('error' in checked) return json(checked, { status: 400 });
			const item = store.update(params.id!, checked.fields);
			if (!item) return notFound('Not found.');
			return json({ item });
		},
		DELETE: ({ params }) => (store.remove(params.id!) ? noContent() : notFound('Not found.'))
	};
}
