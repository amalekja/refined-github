import './color-moved.css';

import * as pageDetect from 'github-url-detection';

import features from '../feature-manager.js';

import observe from '../helpers/selector-observer.js';

const tableSelector = '[class*="DiffLines-module__tableLayoutFixed"]';
const movedClass = 'rgh-color-moved';
const minimumMovedCharacters = 20;

type DiffLine = {
	element: HTMLElement;
	text: string;
};

type DiffBlock = DiffLine[];

function getLineText(element: HTMLElement): string {
	return element.querySelector('[class*="DiffLines-module__code"]')?.textContent ?? '';
}

function getChangedLines(table: HTMLElement, type: 'addition' | 'deletion'): DiffLine[] {
	return [...table.querySelectorAll<HTMLElement>(`.${type}`)].map(element => ({
		element: element.closest('tr') ?? element,
		text: getLineText(element),
	}));
}

function getBlocks(table: HTMLElement, type: 'addition' | 'deletion'): DiffBlock[] {
	const lines = getChangedLines(table, type);
	const blocks: DiffBlock[] = [];

	for (let index = 0; index < lines.length;) {
		const block = [lines[index]];

		for (let next = index + 1; next < lines.length; next++) {
			if (lines[next].element.previousElementSibling !== lines[next - 1].element) {
				break;
			}

			block.push(lines[next]);
		}

		blocks.push(block);
		index += block.length;
	}

	return blocks;
}

function score(block: DiffBlock): number {
	return block.reduce(
		(total, line) => total + (line.text.match(/[a-zA-Z0-9]/g)?.length ?? 0),
		0,
	);
}

/**
 * Finds the longest contiguous sequence shared by two changed blocks.
 *
 * This is deliberately a contiguous match rather than a general LCS:
 * moved code needs to remain a block, otherwise unrelated lines could
 * be painted as moved.
 */
function findLongestMatch(
	deletions: DiffBlock,
	additions: DiffBlock,
	used: Set<HTMLElement>,
): {deletions: DiffBlock; additions: DiffBlock} | undefined {
	let bestLength = 0;
	let bestDeletionStart = 0;
	let bestAdditionStart = 0;

	const lengths = new Array(additions.length + 1).fill(0);

	for (let deletionIndex = deletions.length - 1; deletionIndex >= 0; deletionIndex--) {
		const nextLengths = new Array(additions.length + 1).fill(0);

		for (let additionIndex = additions.length - 1; additionIndex >= 0; additionIndex--) {
			if (
				deletions[deletionIndex].text !== additions[additionIndex].text ||
				used.has(additions[additionIndex].element)
			) {
				continue;
			}

			nextLengths[additionIndex] = lengths[additionIndex + 1] + 1;

			if (nextLengths[additionIndex] > bestLength) {
				bestLength = nextLengths[additionIndex];
				bestDeletionStart = deletionIndex;
				bestAdditionStart = additionIndex;
			}
		}

		lengths.splice(0, lengths.length, ...nextLengths);
	}

	if (bestLength === 0) {
		return;
	}

	const matchedDeletions = deletions.slice(
		bestDeletionStart,
		bestDeletionStart + bestLength,
	);

	const matchedAdditions = additions.slice(
		bestAdditionStart,
		bestAdditionStart + bestLength,
	);

	if (score(matchedDeletions) < minimumMovedCharacters) {
		return;
	}

	return {
		deletions: matchedDeletions,
		additions: matchedAdditions,
	};
}

function colorMoved(table: HTMLElement): void {
	for (const element of table.querySelectorAll<HTMLElement>(`.${movedClass}`)) {
		element.classList.remove(
			movedClass,
			'rgh-color-moved-addition',
			'rgh-color-moved-deletion',
		);
	}

	const deletionBlocks = getBlocks(table, 'deletion');
	const additionBlocks = getBlocks(table, 'addition');

	const usedDeletions = new Set<HTMLElement>();
	const usedAdditions = new Set<HTMLElement>();

	while (true) {
		let bestMatch:
			| {deletions: DiffBlock; additions: DiffBlock}
			| undefined;

		for (const deletionBlock of deletionBlocks) {
			const remainingDeletions = deletionBlock.filter(
				line => !usedDeletions.has(line.element),
			);

			if (remainingDeletions.length === 0) {
				continue;
			}

			for (const additionBlock of additionBlocks) {
				const remainingAdditions = additionBlock.filter(
					line => !usedAdditions.has(line.element),
				);

				if (remainingAdditions.length === 0) {
					continue;
				}

				const match = findLongestMatch(
					remainingDeletions,
					remainingAdditions,
					usedAdditions,
				);

				if (
					match &&
					(!bestMatch || score(match.deletions) > score(bestMatch.deletions))
				) {
					bestMatch = match;
				}
			}
		}

		if (!bestMatch) {
			break;
		}

		for (const line of bestMatch.deletions) {
			line.element.classList.add(
				movedClass,
				'rgh-color-moved-deletion',
			);
			usedDeletions.add(line.element);
		}

		for (const line of bestMatch.additions) {
			line.element.classList.add(
				movedClass,
				'rgh-color-moved-addition',
			);
			usedAdditions.add(line.element);
		}
	}
}

function init(signal: AbortSignal): void {
	observe(tableSelector, colorMoved, {signal});
}

void features.add(import.meta.url, {
	include: [
		pageDetect.isPR,
		pageDetect.isCompare,
		pageDetect.isCommit,
	],
	init,
});
