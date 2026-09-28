import { personas } from '$lib/server/config.js';
import { collectionRoutes } from '$lib/server/crud.js';
import { personaFields } from '$lib/server/fields.js';

// Personas: Docent's reviewer with a point of view, for Settings and the panel.
export const { GET, POST, PUT } = collectionRoutes(personas, personaFields);
