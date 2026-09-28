import { externalReviewers } from '$lib/server/config.js';
import { itemRoutes } from '$lib/server/crud.js';
import { externalFields } from '$lib/server/fields.js';

export const { PUT, DELETE } = itemRoutes(externalReviewers, externalFields);
