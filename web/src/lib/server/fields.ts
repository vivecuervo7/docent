import type { Provider } from '../storage/settings.server.js';

// Checking and tidying the fields the Settings page sends, for providers,
// personas and external reviewers; `partial` for an edit.

type Checked = { fields: Record<string, unknown> } | { error: string };

// A provider's key is never sent back, only whether it has one.
export const publicProvider = ({ apiKey, ...rest }: Provider) => ({ ...rest, hasKey: !!apiKey });

export function providerFields(body: unknown, partial: boolean): Checked {
	const b = (body ?? {}) as Record<string, unknown>;
	const fields: Record<string, unknown> = {};
	if (b.name !== undefined || !partial) {
		if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return { error: 'Give it a name, up to 60 characters.' };
		fields.name = b.name.trim();
	}
	if (b.baseUrl !== undefined || !partial) {
		const url = typeof b.baseUrl === 'string' ? b.baseUrl.trim().replace(/\/+$/, '') : '';
		if (!/^https?:\/\/[^\s]+$/.test(url) || url.length > 500) return { error: 'The address should start with http:// or https://.' };
		fields.baseUrl = url;
	}
	if (b.concurrency !== undefined || !partial) {
		const n = b.concurrency ?? 1;
		if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 16) return { error: 'Requests at once should be from 1 to 16.' };
		fields.concurrency = n;
	}
	if (b.apiKey !== undefined) {
		if (b.apiKey !== null && (typeof b.apiKey !== 'string' || b.apiKey.length > 1000)) return { error: "That key isn't valid." };
		fields.apiKey = typeof b.apiKey === 'string' && b.apiKey.trim() ? b.apiKey.trim() : partial ? null : undefined;
	}
	return { fields };
}

function textField(b: Record<string, unknown>, key: string, max: number, required: boolean, fields: Record<string, unknown>, message: string) {
	if (b[key] === undefined && !required) return null;
	if (b[key] === null && !required) {
		fields[key] = null;
		return null;
	}
	if (typeof b[key] !== 'string' || (required && !(b[key] as string).trim()) || (b[key] as string).length > max) return message;
	fields[key] = (b[key] as string).trim() || null;
	return null;
}

export function personaFields(body: unknown, partial: boolean): Checked {
	const b = (body ?? {}) as Record<string, unknown>;
	const fields: Record<string, unknown> = {};
	const error =
		textField(b, 'name', 60, !partial || b.name !== undefined, fields, 'Give it a name, up to 60 characters.') ??
		textField(b, 'instructions', 4000, !partial || b.instructions !== undefined, fields, 'Say what it looks for.');
	return error ? { error } : { fields };
}

export function externalFields(body: unknown, partial: boolean): Checked {
	const b = (body ?? {}) as Record<string, unknown>;
	const fields: Record<string, unknown> = {};
	if (b.runner !== undefined || !partial) {
		if (b.runner !== 'claude-code' && b.runner !== 'codex') return { error: 'Choose Claude Code or Codex.' };
		fields.runner = b.runner;
	}
	const error =
		textField(b, 'name', 60, !partial || b.name !== undefined, fields, 'Give it a name, up to 60 characters.') ??
		textField(b, 'command', 2000, !partial || b.command !== undefined, fields, 'Give it a prompt to run.') ??
		textField(b, 'model', 200, false, fields, "That model isn't valid.") ??
		textField(b, 'tools', 500, false, fields, "Those tools aren't valid.");
	return error ? { error } : { fields };
}
