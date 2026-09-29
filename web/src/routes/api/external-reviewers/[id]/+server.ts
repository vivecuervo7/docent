import { externalReviewers } from '$lib/storage/settings.server.js';
import { itemRoutes } from '$lib/features/settings/crud.server.js';
import { externalFields } from '$lib/features/settings/fields.server.js';

export const { PUT, DELETE } = itemRoutes(externalReviewers, externalFields);
