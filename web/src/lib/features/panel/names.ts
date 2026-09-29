import { animals, colors } from 'unique-names-generator';

// Reviewer names in the style of generated handles: a colour and an animal,
// kebab-cased so they're one word to type ("as copper-eagle"). Words that
// read badly on a review, or mean something else in code, are left out.

const SKIP_COLOURS = new Set(['tomato', 'moccasin', 'chocolate', 'coffee', 'salmon', 'black', 'white', 'harlequin', 'amaranth']);
const SKIP_ANIMALS = new Set([
	// pests and parasites
	'aphid', 'bedbug', 'cockroach', 'earthworm', 'earwig', 'flea', 'hookworm', 'leech', 'louse', 'mite', 'mosquito', 'rat', 'roundworm', 'termite', 'tick', 'worm', 'locust', 'slug',
	// code words
	'bug', 'python', 'swift', 'asp', 'kite', 'mule', 'cattle', 'boa',
	// categories rather than animals
	'amphibian', 'bird', 'bovid', 'canid', 'canidae', 'cephalopod', 'felidae', 'fish', 'fowl', 'galliform', 'gamefowl', 'landfowl', 'junglefowl', 'wildfowl', 'mammal', 'marsupial', 'mollusk', 'pinniped', 'primate', 'reptile', 'rodent', 'xerinae', 'planarian',
	// obscure, or awkward in a sentence
	'booby', 'gayal', 'guan', 'leopon', 'quelea', 'smelt', 'sole', 'tahr', 'takin', 'tiglon', 'urial', 'constrictor', 'coral', 'silverfish'
]);

const COLOURS = colors.filter((c) => !SKIP_COLOURS.has(c));
const ANIMALS = animals.filter((a) => !SKIP_ANIMALS.has(a));

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// A name not yet handed out on this PR.
export function reviewerName(used: Iterable<string>): string {
	const taken = new Set(used);
	for (;;) {
		const name = `${pick(COLOURS)}-${pick(ANIMALS)}`;
		if (!taken.has(name)) return name;
	}
}
