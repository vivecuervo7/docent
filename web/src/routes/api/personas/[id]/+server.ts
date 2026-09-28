import { personas } from '$lib/server/config.js';
import { itemRoutes } from '$lib/server/crud.js';
import { personaFields } from '$lib/server/fields.js';

export const { PUT, DELETE } = itemRoutes(personas, personaFields);
