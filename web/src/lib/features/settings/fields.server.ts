import { providers, type Provider } from '../../storage/settings.server.js';
import { splitCommand } from '../../models/providerKey.server.js';

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
	if (b.apiKeyCommand !== undefined) {
		if (b.apiKeyCommand !== null && (typeof b.apiKeyCommand !== 'string' || b.apiKeyCommand.length > 500)) return { error: "That key command isn't valid." };
		const command = typeof b.apiKeyCommand === 'string' ? b.apiKeyCommand.trim() : '';
		try {
			splitCommand(command);
		} catch (err) {
			return { error: (err as Error).message };
		}
		fields.apiKeyCommand = command || (partial ? null : undefined);
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
		if (b.runner !== 'claude-code' && b.runner !== 'codex' && b.runner !== 'provider') return { error: 'Choose where it runs.' };
		fields.runner = b.runner;
		if (b.runner === 'provider') {
			if (typeof b.provider !== 'string' || !providers().some((p) => p.id === b.provider)) return { error: 'Choose one of your providers.' };
			fields.provider = b.provider;
		} else {
			fields.provider = null;
		}
	}
	// A prompt run directly on a model is the whole of the review's instructions, so it runs long.
	const promptLimit = b.runner === 'provider' ? 20000 : 2000;
	const error =
		textField(b, 'name', 60, !partial || b.name !== undefined, fields, 'Give it a name, up to 60 characters.') ??
		textField(b, 'command', promptLimit, !partial || b.command !== undefined, fields, `Give it a prompt to run, up to ${promptLimit.toLocaleString('en-US')} characters.`) ??
		textField(b, 'model', 200, false, fields, "That model isn't valid.") ??
		textField(b, 'tools', 500, false, fields, "Those tools aren't valid.");
	if (!error && b.runner === 'provider' && !fields.model) return { error: 'Choose a model.' };
	return error ? { error } : { fields };
}
