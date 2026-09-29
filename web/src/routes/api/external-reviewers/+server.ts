import { externalReviewers } from '$lib/storage/settings.server.js';
import { collectionRoutes } from '$lib/server/crud.js';
import { externalFields } from '$lib/server/fields.js';
import { ALWAYS_ALLOWED } from '$lib/server/sessions.js';

// External reviewers: the reviewer's own sessions, for Settings and the panel.
export const { GET, POST, PUT } = collectionRoutes(externalReviewers, externalFields, () => ({ alwaysAllowed: ALWAYS_ALLOWED }));
