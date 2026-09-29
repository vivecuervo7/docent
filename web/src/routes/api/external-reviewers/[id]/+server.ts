import { externalReviewers } from '$lib/storage/settings.server.js';
import { itemRoutes } from '$lib/server/crud.js';
import { externalFields } from '$lib/server/fields.js';

export const { PUT, DELETE } = itemRoutes(externalReviewers, externalFields);
