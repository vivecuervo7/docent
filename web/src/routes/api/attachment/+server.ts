import type { RequestHandler } from './$types';
import { fetchAttachment } from '$lib/server/github.js';
import { badRequest, failed } from '$lib/server/http.js';

export const GET: RequestHandler = async ({ url }) => {
	const target = url.searchParams.get('url');
	if (!target) return badRequest('missing url');
	try {
		const attachment = await fetchAttachment(target);
		if (!attachment) return new Response(null, { status: 404 });
		return new Response(new Uint8Array(attachment.body), { headers: { 'Content-Type': attachment.contentType } });
	} catch (err) {
		return failed(err);
	}
};
