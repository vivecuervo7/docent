import { externalReviewers } from '$lib/storage/settings.server.js';
import { collectionRoutes } from '$lib/features/settings/crud.server.js';
import { externalFields } from '$lib/features/settings/fields.server.js';
import { ALWAYS_ALLOWED } from '$lib/features/panel/externalSessions.server.js';

// External reviewers: the reviewer's own sessions, for Settings and the panel.
export const { GET, POST, PUT } = collectionRoutes(externalReviewers, externalFields, () => ({ alwaysAllowed: ALWAYS_ALLOWED }));
