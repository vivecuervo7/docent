import { personas } from '$lib/storage/settings.server.js';
import { collectionRoutes } from '$lib/features/settings/crud.server.js';
import { personaFields } from '$lib/features/settings/fields.server.js';

// Personas: Docent's reviewer with a point of view, for Settings and the panel.
export const { GET, POST, PUT } = collectionRoutes(personas, personaFields);
