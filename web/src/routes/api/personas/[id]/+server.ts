import { personas } from '$lib/storage/settings.server.js';
import { itemRoutes } from '$lib/server/crud.js';
import { personaFields } from '$lib/server/fields.js';

export const { PUT, DELETE } = itemRoutes(personas, personaFields);
