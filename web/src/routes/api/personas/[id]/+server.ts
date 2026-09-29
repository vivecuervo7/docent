import { personas } from '$lib/storage/settings.server.js';
import { itemRoutes } from '$lib/features/settings/crud.server.js';
import { personaFields } from '$lib/features/settings/fields.server.js';

export const { PUT, DELETE } = itemRoutes(personas, personaFields);
